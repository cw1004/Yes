"""실전 루프 상태를 보는 읽기 전용 화면.

시뮬레이션 대시보드(server.py)와 달리 여기서는 아무것도 조작할 수 없습니다.
실계좌가 도는 중에 브라우저 버튼 하나로 사고가 나는 걸 막으려는 것입니다.
정지는 콘솔 Ctrl+C 또는 킬 스위치 파일로만 합니다.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>실전 매매 모니터</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>&#128200;</text></svg>">
<style>
:root{--bg:#0b0e14;--panel:#131824;--line:#242c3d;--txt:#e6ebf5;--dim:#8794ad;
--up:#22c55e;--down:#ef4444;--warn:#f59e0b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-size:13px;
font-family:"Pretendard","Apple SD Gothic Neo",system-ui,sans-serif}
header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;
gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:15px;margin:0}
.badge{padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid var(--line)}
.live{background:#301518;color:#fca5a5;border-color:#7f2027}
.paper{background:#0f2e1c;color:#4ade80;border-color:#1a5c37}
.warn{background:#2a1a10;color:#fcd34d;border-color:#7c4a12}
.grow{flex:1}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
.wrap{padding:12px 16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
.lbl{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.6px}
.big{font-size:22px;font-weight:800;letter-spacing:-.5px}
.row{display:flex;gap:8px;align-items:center}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:var(--dim);font-weight:600;padding:4px 6px;font-size:10px;
text-transform:uppercase;letter-spacing:.5px}
td{padding:5px 6px;border-top:1px solid var(--line)}
.bar{height:7px;border-radius:4px;background:#0e1420;border:1px solid var(--line);
position:relative;overflow:hidden;margin-top:4px}
.bar>i{position:absolute;top:0;bottom:0;left:0}
.log{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:0 16px 16px;
padding:8px 12px;max-height:320px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
.log div{padding:2px 0;border-top:1px solid #1b2333;white-space:pre-wrap}
.log div:first-child{border-top:none}
.up{color:var(--up)}.down{color:var(--down)}.dim{color:var(--dim)}.wrn{color:var(--warn)}
</style></head><body>
<header>
  <h1>&#128200; 실전 매매 모니터</h1>
  <span id="mode" class="badge">-</span>
  <span id="conn" class="badge">연결 중…</span>
  <span class="grow"></span>
  <span class="lbl">당일 실현</span><b id="pnl" class="mono">-</b>
  <span class="lbl">매매</span><b id="trades" class="mono">-</b>
  <span class="lbl">보유</span><b id="held" class="mono">-</b>
</header>
<div id="guard" class="wrap" style="padding-bottom:0"></div>
<div class="wrap">
  <div class="card"><div class="lbl">보유 포지션</div><div id="positions"></div></div>
  <div class="card"><div class="lbl">슬롯 상태</div><div id="slots"></div></div>
</div>
<div class="log" id="log"></div>
<script>
const $=s=>document.querySelector(s);
const f=(v,d=2)=>(v==null||isNaN(v))?'-':Number(v).toFixed(d);
const sg=v=>(v>0?'+':'')+f(v);
const cl=v=>v>0?'up':(v<0?'down':'dim');

function render(s){
  const mode=$('#mode');
  mode.textContent = s.paper ? '페이퍼 계좌' : '⚠ 실계좌';
  mode.className = 'badge ' + (s.paper?'paper':'live');

  const d=s.day||{};
  const p=$('#pnl'); p.textContent = sg(d.realized)+'$ ('+sg(d.pct)+'%)';
  p.className='mono '+cl(d.realized);
  $('#trades').textContent = (d.trades||0)+'건 / 승 '+(d.wins||0);
  $('#held').textContent = (s.positions||[]).length+'건';

  const g=s.guard||{};
  $('#guard').innerHTML = `<div class="card" style="border-color:${
    g.halted?'#7f2027':(g.can_enter?'#1a5c37':'#7c4a12')}">
    <div class="row"><span class="lbl">진입 가능</span>
      <span class="badge ${g.halted?'live':(g.can_enter?'paper':'warn')}">${
        g.halted?'정지됨':(g.can_enter?'가능':'차단')}</span>
      <span class="grow"></span>
      <span class="lbl">청산</span>
      <span class="badge ${g.can_exit?'paper':'warn'}">${g.can_exit?'가능':'불가'}</span></div>
    <div class="dim" style="margin-top:6px">${(g.reasons||[]).join(' / ')||'모든 조건 통과'}</div>
  </div>`;

  const pos=s.positions||[];
  $('#positions').innerHTML = pos.length ? `<table><tr><th>종목</th><th>수량</th>
    <th>진입</th><th>현재</th><th>손익</th><th>보유</th></tr>` + pos.map(x=>{
      const range=(x.target-x.stop)||1;
      const prog=Math.max(0,Math.min(100,(x.price-x.stop)/range*100));
      return `<tr><td><b>${x.ticker}</b><div class="bar"><i style="width:${prog}%;
        background:var(--${x.pnl_pct>=0?'up':'down'})"></i></div></td>
        <td class="mono">${f(x.qty,0)}</td><td class="mono">${f(x.entry)}</td>
        <td class="mono">${f(x.price)}</td>
        <td class="mono ${cl(x.pnl_pct)}">${sg(x.pnl_pct)}%</td>
        <td class="mono">${f(x.held_min,0)}분</td></tr>`;
    }).join('') + '</table>' : '<div class="dim" style="padding:8px 0">보유 없음</div>';

  const slotHead = '<tr><th>슬롯</th><th>종목</th><th>가격</th><th>점수</th><th>상태</th></tr>';
  $('#slots').innerHTML = '<table>' + slotHead + (s.slots||[]).map(x=>
    `<tr><td>SLOT${x.index}</td><td><b>${x.ticker}</b></td>
     <td class="mono">${f(x.price)}</td><td class="mono">${f(x.score,0)}</td>
     <td class="dim">${x.blocked_by||'—'}</td></tr>`).join('') + '</table>';

  $('#log').innerHTML = (s.log||[]).slice().reverse().map(l=>{
    let c='dim';
    if(l.includes(' ENTRY ')||l.includes(' BUY ')) c='up';
    else if(l.includes(' EXIT ')||l.includes(' SELL ')) c='down';
    else if(l.includes(' REJECT ')||l.includes(' GUARD ')||l.includes(' WARN ')) c='wrn';
    else if(l.includes(' ERROR ')||l.includes(' HALT ')) c='down';
    return `<div class="${c}">${l.replace(/</g,'&lt;')}</div>`;
  }).join('');
}

async function tick(){
  try{
    const r = await fetch('/api/live',{cache:'no-store'});
    render(await r.json());
    $('#conn').textContent='정상'; $('#conn').className='badge paper';
  }catch(e){ $('#conn').textContent='끊김'; $('#conn').className='badge live'; }
}
tick(); setInterval(tick, 2000);
</script></body></html>"""


class MonitorHandler(BaseHTTPRequestHandler):
    runner = None

    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            return self._send(200, PAGE.encode(), "text/html; charset=utf-8")
        if path == "/api/live":
            payload = json.dumps(self.runner.state(), ensure_ascii=False)
            return self._send(200, payload.encode(), "application/json; charset=utf-8")
        self._send(404, b"not found", "text/plain")

    # 읽기 전용입니다. 실계좌가 도는 중에 브라우저로 조작할 수 없게 막습니다.
    def do_POST(self) -> None:
        self._send(405, b"read-only monitor", "text/plain")


def serve(runner, host: str = "127.0.0.1", port: int = 8790) -> ThreadingHTTPServer:
    handler = type("BoundMonitor", (MonitorHandler,), {"runner": runner})
    httpd = ThreadingHTTPServer((host, port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
