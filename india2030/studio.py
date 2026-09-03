# -*- coding: utf-8 -*-
"""INDIA 2030 스튜디오 — 브라우저에서 여는 실행 화면.

터미널 명령을 외우지 않아도 회차·언어·화면비를 고르고 버튼 한 번으로
영상을 만들 수 있다. 표준 라이브러리만 사용하며, 내부적으로는
`python -m india2030 make ...` 를 그대로 실행한다.

    python3 -m india2030 studio            # 브라우저 자동 실행
    python3 -m india2030 studio --port 9000 --no-browser
"""

from __future__ import annotations

import html
import json
import mimetypes
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .episodes import ACTS, TITLES

ROOT = Path(__file__).resolve().parent.parent
MAX_LOG_LINES = 800


class Job:
    """실행 중인 생성 작업 하나. 동시에 한 개만 허용한다."""

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.lines: list[str] = []
        self.cmd = ""
        self.started_at = 0.0
        self.finished_at = 0.0
        self.returncode: int | None = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, argv: list[str], out_dir: Path) -> None:
        with self._lock:
            if self.running:
                raise RuntimeError("이미 실행 중인 작업이 있습니다.")
            self.lines = []
            self.returncode = None
            self.finished_at = 0.0
            self.started_at = time.time()
            self.cmd = " ".join(shlex.quote(a) for a in argv)
            env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
            self.proc = subprocess.Popen(
                argv, cwd=str(ROOT), env=env, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", bufsize=1,
                start_new_session=(os.name != "nt"),
            )
        threading.Thread(target=self._pump, args=(out_dir,), daemon=True).start()

    def _pump(self, out_dir: Path) -> None:
        assert self.proc and self.proc.stdout
        for line in self.proc.stdout:
            line = line.rstrip("\n")
            with self._lock:
                self.lines.append(line)
                if len(self.lines) > MAX_LOG_LINES:
                    del self.lines[:-MAX_LOG_LINES]
        self.proc.wait()
        with self._lock:
            self.returncode = self.proc.returncode
            self.finished_at = time.time()

    def stop(self) -> bool:
        with self._lock:
            if not self.running:
                return False
            assert self.proc
            try:
                if os.name == "nt":
                    self.proc.terminate()
                else:
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            except (ProcessLookupError, PermissionError, OSError):
                self.proc.terminate()
            self.lines.append("[중지 요청됨]")
            return True

    def snapshot(self) -> dict:
        with self._lock:
            elapsed = (self.finished_at or time.time()) - self.started_at
            return {
                "running": self.running,
                "cmd": self.cmd,
                "lines": list(self.lines),
                "returncode": self.returncode,
                "elapsed": round(elapsed, 1) if self.started_at else 0,
            }


JOB = Job()


def build_argv(form: dict, out_dir: Path) -> list[str]:
    """폼 값을 그대로 CLI 인자로 옮긴다. 알 수 없는 값은 무시한다."""
    def pick(key, allowed, default):
        v = str(form.get(key, default))
        return v if v in allowed else default

    rng = str(form.get("range", "1-1")).strip() or "1-1"
    if not all(c.isdigit() or c in "-, " for c in rng):
        raise ValueError("회차 범위는 숫자와 '-' 만 쓸 수 있습니다 (예: 1-10).")

    argv = [sys.executable, "-m", "india2030", "make", "--range", rng,
            "--out", str(out_dir)]
    argv += ["--lang", pick("lang", {"ko", "hi"}, "ko")]
    argv += ["--caption-lang", pick("caption_lang", {"ko", "hi"}, "ko")]
    argv += ["--aspect", pick("aspect", {"9:16", "1:1", "16:9"}, "9:16")]
    argv += ["--tts", pick("tts", {"auto", "edge", "gtts", "silent"}, "auto")]
    argv += ["--transition", pick("transition", {"xfade", "fade", "cut"}, "xfade")]
    argv += ["--script-provider", pick("provider", {"template", "llm"}, "template")]

    try:
        workers = max(1, min(8, int(form.get("workers", 2))))
    except (TypeError, ValueError):
        workers = 2
    argv += ["--workers", str(workers)]

    bgm = ROOT / "assets" / "bgm"
    if bgm.is_dir() and any(bgm.iterdir()):
        argv += ["--bgm", str(bgm)]
    if form.get("overwrite"):
        argv.append("--overwrite")
    if form.get("no_subtitle"):
        argv.append("--no-subtitle")
    return argv


def list_outputs(out_dir: Path) -> list[dict]:
    vids = sorted((out_dir / "video").glob("*.mp4"), key=lambda p: p.name)
    items = []
    for v in vids:
        thumb = v.with_name(v.stem.split("_")[0] + "_thumb.jpg")
        items.append({
            "name": v.name,
            "size_mb": round(v.stat().st_size / 1048576, 1),
            "mtime": time.strftime("%H:%M:%S", time.localtime(v.stat().st_mtime)),
            "url": "/file/video/" + urllib.parse.quote(v.name),
            "thumb": "/file/video/" + urllib.parse.quote(thumb.name) if thumb.exists() else "",
        })
    return items


PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>INDIA 2030 스튜디오</title>
<style>
  :root{--bg:#140b06;--panel:#20130c;--line:#402616;--fg:#f6ece2;--dim:#b7936d;
        --saffron:#FF9933;--green:#138808;--gold:#FFC061}
  *{box-sizing:border-box}
  body{margin:0;background:linear-gradient(160deg,#140b06,#2a1409 60%,#3a1c08);
       color:#f6ece2;font:14px/1.6 system-ui,"Noto Sans KR",sans-serif;min-height:100vh}
  header{padding:22px 24px 14px;border-bottom:1px solid #402616}
  h1{margin:0;font-size:20px;letter-spacing:.14em}
  h1 b{color:#FF9933}
  .tag{margin-top:6px;font-size:12px;letter-spacing:.18em;color:#b7936d}
  main{display:grid;grid-template-columns:340px 1fr;gap:18px;padding:18px 24px 40px}
  @media(max-width:860px){main{grid-template-columns:1fr}}
  .card{background:#20130c;border:1px solid #402616;border-radius:12px;padding:16px}
  .card h2{margin:0 0 12px;font-size:13px;letter-spacing:.12em;color:#FFC061;font-weight:600}
  label{display:block;margin:10px 0 4px;font-size:12px;color:#b7936d}
  input,select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid #402616;
       background:#160d07;color:#f6ece2;font:inherit}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .chk{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:#d9c3ab}
  .chk input{width:auto}
  button{width:100%;margin-top:14px;padding:11px;border:0;border-radius:9px;
       font:600 14px/1 system-ui;cursor:pointer;letter-spacing:.05em}
  #go{background:linear-gradient(90deg,#FF9933,#FFC061);color:#2a1409}
  #go:disabled{opacity:.45;cursor:not-allowed}
  #stop{background:#3a1c14;color:#ffb4a2;border:1px solid #5c2a1e}
  pre{margin:0;padding:12px;background:#0e0805;border:1px solid #402616;border-radius:10px;
      height:300px;overflow:auto;font:12px/1.55 ui-monospace,Menlo,monospace;color:#d8ccc0;
      white-space:pre-wrap;word-break:break-all}
  .status{display:flex;gap:10px;align-items:center;font-size:12px;color:#b7936d;margin-bottom:8px}
  .dot{width:8px;height:8px;border-radius:50%;background:#5c4433}
  .dot.on{background:#7CFF9B;box-shadow:0 0 8px #7CFF9B}
  .files{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px}
  .f{border:1px solid #402616;border-radius:10px;overflow:hidden;background:#160d07}
  .f img,.f video{width:100%;display:block;aspect-ratio:9/16;object-fit:cover;background:#000}
  .f div{padding:7px 8px;font-size:11px;color:#b7936d;word-break:break-all}
  .f a{color:#FFC061;text-decoration:none}
  .ep{font-size:12px;color:#8f7358;margin-top:8px;line-height:1.5}
  .warn{margin-top:12px;padding:9px 11px;border-radius:8px;background:#2a1a0c;
        border:1px solid #5a3a12;color:#ffcf8a;font-size:12px}
</style></head><body>
<header>
  <h1>INDIA <b>2030</b> — 스튜디오</h1>
  <div class="tag">ONE BOY. ONE BALL. ONE DREAM. ONE NATION.</div>
</header>
<main>
  <section class="card">
    <h2>생성 설정</h2>
    <label>회차 범위 (예: 1 / 1-10 / 1-100)</label>
    <input id="range" value="1-1">
    <div class="ep" id="eptitle"></div>
    <div class="row">
      <div><label>내레이션</label>
        <select id="lang"><option value="ko">한국어</option><option value="hi">힌디어</option></select></div>
      <div><label>자막</label>
        <select id="caption_lang"><option value="ko">한국어</option><option value="hi">힌디어</option></select></div>
    </div>
    <div class="row">
      <div><label>화면비</label>
        <select id="aspect"><option>9:16</option><option>1:1</option><option>16:9</option></select></div>
      <div><label>동시 처리</label>
        <select id="workers"><option>1</option><option selected>2</option><option>4</option><option>6</option></select></div>
    </div>
    <div class="row">
      <div><label>음성 엔진</label>
        <select id="tts"><option value="auto">자동</option><option value="edge">edge</option>
        <option value="gtts">gTTS</option><option value="silent">무음</option></select></div>
      <div><label>전환 효과</label>
        <select id="transition"><option>xfade</option><option>fade</option><option>cut</option></select></div>
    </div>
    <label class="chk"><input type="checkbox" id="overwrite"> 이미 만든 영상 덮어쓰기</label>
    <label class="chk"><input type="checkbox" id="no_subtitle"> 자막 없이 만들기</label>
    <button id="go">영상 만들기</button>
    <button id="stop">중지</button>
    <div class="warn" id="warn" hidden></div>
  </section>
  <section>
    <div class="card">
      <h2>실행 로그</h2>
      <div class="status"><span class="dot" id="dot"></span><span id="stat">대기 중</span></div>
      <pre id="log">아직 실행하지 않았습니다.

왼쪽에서 회차를 고르고 [영상 만들기] 를 누르세요.
60초 영상 1편에 약 2~4분 걸립니다.</pre>
    </div>
    <div class="card" style="margin-top:18px">
      <h2>생성된 영상</h2>
      <div class="files" id="files"></div>
    </div>
  </section>
</main>
<script>
const $ = i => document.getElementById(i);
const TITLES = __TITLES__;
function showTitle(){
  const m = /^\\s*(\\d+)/.exec($('range').value);
  const n = m ? +m[1] : 0;
  $('eptitle').textContent = (n>=1 && n<=TITLES.length) ? n+'화 · '+TITLES[n-1] : '';
}
$('range').addEventListener('input', showTitle); showTitle();
$('go').onclick = async () => {
  const body = {range:$('range').value, lang:$('lang').value,
    caption_lang:$('caption_lang').value, aspect:$('aspect').value,
    workers:$('workers').value, tts:$('tts').value, transition:$('transition').value,
    overwrite:$('overwrite').checked, no_subtitle:$('no_subtitle').checked};
  const r = await fetch('/api/run',{method:'POST',body:JSON.stringify(body)});
  const j = await r.json();
  const w = $('warn');
  if(j.error){ w.hidden=false; w.textContent = j.error; } else { w.hidden=true; }
};
$('stop').onclick = () => fetch('/api/stop',{method:'POST'});
async function poll(){
  try{
    const j = await (await fetch('/api/status')).json();
    $('dot').className = 'dot' + (j.running ? ' on' : '');
    $('stat').textContent = j.running
      ? '실행 중 · ' + j.elapsed + '초 경과'
      : (j.returncode === null ? '대기 중'
         : j.returncode === 0 ? '완료 · ' + j.elapsed + '초'
         : j.returncode < 0 ? '중지됨'
         : '실패 (코드 ' + j.returncode + ')');
    $('go').disabled = j.running;
    if(j.lines.length){
      const el = $('log'), stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
      el.textContent = j.lines.join('\\n');
      if(stick) el.scrollTop = el.scrollHeight;
    }
    const files = await (await fetch('/api/files')).json();
    $('files').innerHTML = files.map(f =>
      `<div class="f">${f.thumb?`<img src="${f.thumb}" loading="lazy">`:''}
       <div>${f.name}<br>${f.size_mb}MB · ${f.mtime}<br>
       <a href="${f.url}" target="_blank">재생</a> ·
       <a href="${f.url}" download>내려받기</a></div></div>`).join('')
      || '<div class="ep">아직 없습니다.</div>';
  }catch(e){ $('stat').textContent = '서버 연결 끊김'; }
}
poll(); setInterval(poll, 1500);
</script></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    out_dir = ROOT / "output"

    def log_message(self, fmt, *args):        # 콘솔을 조용하게
        pass

    # -- helpers ------------------------------------------------------------
    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode())

    # -- routes -------------------------------------------------------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            page = PAGE.replace("__TITLES__", json.dumps(TITLES, ensure_ascii=False))
            return self._send(200, page.encode(), "text/html; charset=utf-8")
        if path == "/api/status":
            return self._json(JOB.snapshot())
        if path == "/api/files":
            return self._json(list_outputs(self.out_dir))
        if path.startswith("/file/"):
            return self._serve_file(path[len("/file/"):])
        return self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/stop":
            return self._json({"stopped": JOB.stop()})
        if path != "/api/run":
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        try:
            n = int(self.headers.get("Content-Length") or 0)
            form = json.loads(self.rfile.read(n) or b"{}")
            argv = build_argv(form, self.out_dir)
            JOB.start(argv, self.out_dir)
        except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
            return self._json({"error": str(exc)}, 400)
        return self._json({"ok": True, "cmd": JOB.cmd})

    def _serve_file(self, rel):
        """output 폴더 안으로만 접근을 제한한다."""
        rel = urllib.parse.unquote(rel)
        base = self.out_dir.resolve()
        target = (base / rel).resolve()
        if not str(target).startswith(str(base) + os.sep) or not target.is_file():
            return self._send(403, b"forbidden", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        size = target.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "none")
        self.end_headers()
        try:
            with open(target, "rb") as fh:
                while chunk := fh.read(262144):
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


def serve(port=8500, out_dir=None, open_browser=True, host="127.0.0.1"):
    Handler.out_dir = Path(out_dir or (ROOT / "output")).resolve()
    (Handler.out_dir / "video").mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    acts = " / ".join(f"ACT{a.no} {a.name}" for a in ACTS)
    print("=" * 58)
    print("  INDIA 2030 스튜디오가 열렸습니다")
    print(f"  브라우저 주소 : {url}")
    print(f"  출력 폴더     : {Handler.out_dir}")
    print(f"  구성          : {acts}")
    print("  종료하려면 이 창에서 Ctrl+C")
    print("=" * 58)
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
    finally:
        JOB.stop()
        httpd.server_close()
    return 0
