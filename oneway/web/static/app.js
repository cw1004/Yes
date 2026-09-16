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

  /* ---------------------------------------------------------- 첫 화면 */
  /* 서버는 시간에 좌우되지 않는 문구를 그린다. 여기서 방문자의 시계를 보고
     지금 시간에 맞는 말로 바꾼다. 자바스크립트가 없어도 그대로 자연스럽다. */
  var HERO_LINES = [
    { until: 6,  l1: "새벽 세 시에도",          l2: "여기 있습니다" },
    { until: 11, l1: "오늘도 버텨야 하는 아침에", l2: "잠깐 앉았다 가세요" },
    { until: 18, l1: "괜찮은 척하느라 지쳤다면",  l2: "여기서는 안 그러셔도 됩니다" },
    { until: 24, l1: "하루를 겨우 끝냈다면",     l2: "혼자 삼키지 마세요" }
  ];

  var PLACEHOLDERS = [
    "지금 마음을 한 문장으로 적어 보세요.",
    "정리하지 않으셔도 됩니다.",
    "오늘 무슨 일이 있으셨습니까.",
    "어디서부터 말해야 할지 모르겠다면, 그렇게 쓰셔도 됩니다."
  ];

  function initHero() {
    var line = document.getElementById("hero-line");
    var input = document.getElementById("hero-input");
    if (!line && !input) return;

    if (line) {
      var hour = new Date().getHours();
      for (var i = 0; i < HERO_LINES.length; i++) {
        if (hour < HERO_LINES[i].until) {
          var l1 = line.querySelector(".l1");
          var l2 = line.querySelector(".l2");
          if (l1) l1.textContent = HERO_LINES[i].l1;
          if (l2) l2.textContent = HERO_LINES[i].l2;
          break;
        }
      }
    }

    if (!input) return;

    /* 한 줄에서 시작해 쓰는 만큼 늘어난다 */
    function grow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 180) + "px";
    }
    input.addEventListener("input", grow);

    /* 엔터로 보낸다. 줄바꿈은 Shift+Enter. */
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        if (input.value.trim()) input.form.submit();
      }
    });

    /* 지금 상태를 한 번에 고르는 단추 */
    document.querySelectorAll(".hero-chips [data-fill]").forEach(function (b) {
      b.addEventListener("click", function () {
        input.value = b.getAttribute("data-fill");
        input.focus();
        grow();
      });
    });

    /* 안내 문구를 천천히 돌린다. 입력 중에는 건드리지 않는다. */
    var n = 0;
    setInterval(function () {
      if (document.activeElement === input || input.value) return;
      n = (n + 1) % PLACEHOLDERS.length;
      input.placeholder = PLACEHOLDERS[n];
    }, 5000);
  }

  /* ---------------------------------------------------------- 상담 대화 */
  /* 답변은 한 덩어리의 말로 온다. 소제목이나 딱지를 붙이지 않는다. */
  function renderReply(log, r) {
    var alert = r.risk === "crisis" || r.risk === "abuse";
    var b = el("div", "bubble ai" + (alert ? " alert" : ""));

    (r.text || "").split("\n\n").forEach(function (para) {
      if (para.trim()) b.appendChild(el("p", null, para));
    });

    if (r.hotlines && r.hotlines.length) {
      var ul = el("ul", "hotlines");
      r.hotlines.forEach(function (h) { ul.appendChild(el("li", null, h)); });
      b.appendChild(ul);
    }

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
    if (r.note) b.appendChild(el("p", "small", r.note));

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
      var wait = el("p", "typing", "…");
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
    if (prefill) {
      input.value = "";
      send(prefill);            /* 첫 화면에서 쓴 말이 바로 이어진다 */
    } else {
      input.focus();
    }
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
    initHero();
    initChat();
    initProgress();
    initBeliefRead();
    initPractice();
    initPray();
  });
})();
