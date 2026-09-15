/* 하나의 길 — ONE WAY
   프레임워크 없이 동작한다. 하는 일은 세 가지.
   1) 상담사와 대화  2) 연속 방문·진행 상황 표시  3) 기도 지향 맡기기 */
(function () {
  "use strict";

  var api = function (path, body) {
    return fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error("요청에 실패했습니다 (" + r.status + ")");
      return r.json();
    });
  };

  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------------------------------------------------------- 상담 대화 */
  function section(parent, label, text) {
    if (!text) return;
    parent.appendChild(el("h4", null, label));
    text.split("\n\n").forEach(function (para) {
      if (para.trim()) parent.appendChild(el("p", null, para));
    });
  }

  function renderReply(log, r) {
    var b = el("div", "bubble ai" + (r.risk === "crisis" || r.risk === "abuse" ? " alert" : ""));

    (r.listen || "").split("\n\n").forEach(function (p) {
      if (p.trim()) b.appendChild(el("p", null, p));
    });

    if (r.hotlines && r.hotlines.length) {
      var ul = el("ul", "hotlines");
      r.hotlines.forEach(function (h) { ul.appendChild(el("li", null, h)); });
      b.appendChild(ul);
    }

    section(b, "", r.insight);

    if (r.verse_ref) {
      var v = el("aside", "verse");
      var ref = el("div", "ref", r.verse_ref);
      ref.appendChild(el("span", "alt", "개신교 표기 · " + r.verse_ref_protestant));
      v.appendChild(ref);
      v.appendChild(el("p", null, r.verse_gist));
      v.appendChild(el("p", "small", "번역문은 싣지 않습니다. 직접 펴서 읽어 보십시오."));
      b.appendChild(v);
    }

    section(b, "오늘의 질문", r.question);
    section(b, "30초 기도", r.prayer);
    section(b, "오늘의 한 걸음", r.step);

    if (r.links && r.links.length) {
      var box = el("div", "links");
      r.links.forEach(function (l) {
        var a = el("a", null, l.label);
        a.href = l.url;
        box.appendChild(a);
      });
      b.appendChild(box);
    }

    if (r.follow_up) b.appendChild(el("p", "small", r.follow_up));
    if (r.disclaimer) b.appendChild(el("p", "small", "(" + r.disclaimer + ")"));

    log.appendChild(b);
    b.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function initChat() {
    var form = document.getElementById("chat-form");
    if (!form) return;
    var log = document.getElementById("log");
    var input = document.getElementById("msg");
    var chat = document.querySelector(".chat");

    function send(text) {
      text = (text || "").trim();
      if (!text) return;
      log.appendChild(el("div", "bubble me", text));
      input.value = "";
      var wait = el("p", "typing", "듣고 있습니다…");
      log.appendChild(wait);
      wait.scrollIntoView({ behavior: "smooth", block: "nearest" });

      api("/api/counsel", { message: text })
        .then(function (data) {
          log.removeChild(wait);
          renderReply(log, data.reply);
          if (data.progress) showProgress(data.progress);
        })
        .catch(function (e) {
          wait.textContent = "연결에 문제가 있었습니다. 잠시 뒤 다시 시도해 주세요. (" + e.message + ")";
        });
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      send(input.value);
    });

    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        send(input.value);
      }
    });

    document.querySelectorAll("[data-q]").forEach(function (btn) {
      btn.addEventListener("click", function () { send(btn.getAttribute("data-q")); });
    });

    var prefill = chat && chat.getAttribute("data-prefill");
    if (prefill) { input.value = prefill; send(prefill); }
    else { send("안녕하세요"); }
  }

  /* ------------------------------------------------- 연속 방문·진행 상황 */
  function bar(done, total) {
    var wrap = el("div", "bar");
    var i = el("i");
    i.style.width = Math.min(100, Math.round((done / total) * 100)) + "%";
    wrap.appendChild(i);
    return wrap;
  }

  function showProgress(p) {
    var box = document.getElementById("streak");
    if (!box || !p) return;
    box.textContent = "";
    var line = p.streak > 1
      ? p.streak + "일째 함께 걷고 있습니다."
      : "오늘 처음 오셨군요. 내일 다시 오시면 함께 걸은 날이 쌓입니다.";
    box.appendChild(el("p", null, line));
    box.appendChild(el("p", "small",
      "우리가 함께 믿는 50가지 — " + p.beliefs_read + " / " + p.beliefs_total));
    box.appendChild(bar(p.beliefs_read, p.beliefs_total));
    box.appendChild(el("p", "small",
      "30일 사랑의 실천 — " + p.practices_done + " / " + p.practices_total));
    box.appendChild(bar(p.practices_done, p.practices_total));
  }

  function initProgress() {
    if (!document.getElementById("streak")) return;
    api("/api/me").then(function (d) { showProgress(d.progress); }).catch(function () {});
  }

  /* --------------------------------------------------------- 읽음 기록 */
  function initBeliefRead() {
    var art = document.querySelector("[data-belief]");
    if (!art) return;
    api("/api/read", { belief: parseInt(art.getAttribute("data-belief"), 10) })
      .catch(function () {});
  }

  /* ------------------------------------------------------ 사랑의 실천 */
  function initPractice() {
    var btn = document.querySelector("[data-practice]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      api("/api/practice", { done: true }).then(function (d) {
        var msg = document.getElementById("practice-msg");
        if (msg) msg.textContent = "기록했습니다. 30일 중 " + d.progress.practices_done + "일째입니다.";
        btn.disabled = true;
        showProgress(d.progress);
      }).catch(function () {});
    });
  }

  /* -------------------------------------------------------- 기도 지향 */
  function initPray() {
    var form = document.getElementById("pray-form");
    if (!form) return;
    var input = document.getElementById("intention");
    var list = document.getElementById("my-intentions");

    api("/api/intentions").then(function (d) { render(d); }).catch(function () {});

    function render(d) {
      list.textContent = "";
      (d.intentions || []).slice().reverse().forEach(function (it) {
        var b = el("div", "bubble");
        b.appendChild(el("p", null, it.text));
        b.appendChild(el("p", "small", it.at.replace("T", " ")));
        list.appendChild(b);
      });
      var c = document.getElementById("pray-count");
      if (c && typeof d.today_count === "number") c.textContent = d.today_count;
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      api("/api/intention", { text: text }).then(function (d) {
        input.value = "";
        render(d);
      }).catch(function () {});
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initChat();
    initProgress();
    initBeliefRead();
    initPractice();
    initPray();
  });
})();
