/*
 * SKY GOAL 2.0 — 경기장 광고판
 *
 * ※ 중요: 여기 그려지는 것은 AdMob 광고가 아니다.
 *   AdMob 은 반드시 공식 광고뷰(AdView/전면/보상형)로만 표시해야 하며,
 *   캔버스에 그린 이미지는 AdMob 노출로 집계되지 않는다.
 *   이 지면은 "직접 판매(직거래) 스폰서 보드"이고, 팔리기 전까지는
 *   자체 홍보(하우스 광고)로 채운다.
 *
 * ※ 클릭 불가: 탭은 오직 공을 띄우는 조작이다. 광고판에는 어떤 히트 영역도 두지 않는다.
 *   (원버튼 게임에서 광고 클릭 영역은 오조작을 유발하고 정책 위반 소지도 있다)
 *
 * 스폰서가 생기면 아래 BOARDS 배열의 문구와 색만 바꾸면 된다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SkyGoalSponsor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CLICKABLE = false;          // 절대 true 로 바꾸지 말 것 (조작과 충돌)

  // house: 자체 홍보 / sponsor: 판매된 지면
  var BOARDS = [
    { id: 'india2030', kind: 'house', text: 'INDIA 2030',
      sub: 'ONE DREAM · ONE NATION', bg: '#12233f', fg: '#ffffff', accent: '#ff9933' },
    { id: 'dream', kind: 'house', text: 'DREAM · BELIEVE · QUALIFY',
      sub: 'हर सपना एक फुटबॉल से', bg: '#123a2a', fg: '#ffffff', accent: '#5ad07a' },
    { id: 'shop', kind: 'house', text: '새 공 만나기',
      sub: 'BALL SHOP', bg: '#2a1a3f', fg: '#ffffff', accent: '#ffd75a' },
    { id: 'follow', kind: 'house', text: 'FOLLOW THE DREAM',
      sub: '2030', bg: '#3a1f14', fg: '#ffffff', accent: '#ff9933' },
    { id: 'slot', kind: 'sponsor', text: 'YOUR BRAND HERE',
      sub: 'sponsor@skygoal', bg: '#1b2431', fg: '#c9d6e6', accent: '#8fa6c0' }
  ];

  function count() { return BOARDS.length; }

  // 골문마다 다른 보드가 걸리도록 순서대로 돌린다.
  function pick(index) {
    var n = BOARDS.length;
    if (!n) return null;
    var i = Math.floor(Math.abs(index || 0)) % n;
    return BOARDS[i];
  }

  var HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
  function hasHangul(text) {
    return HANGUL.test(String(text || ''));
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /**
   * 골대 기둥 세로 배너.
   * 기둥 폭이 좁으므로 글자를 90도 돌려 아래에서 위로 읽게 한다.
   * x,y 는 배너의 좌상단, w 는 기둥 폭, h 는 배너 길이.
   */
  function drawPostBanner(ctx, board, x, y, w, h, alpha) {
    if (!board || h < 70) return false;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = board.bg;
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = board.accent;                 // 위아래 액센트 바
    ctx.fillRect(x + 3, y + 4, w - 6, 3);
    ctx.fillRect(x + 3, y + h - 7, w - 6, 3);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (hasHangul(board.text)) {
      // 한글은 눕히면 읽기 어렵다 — 글자를 세로로 쌓는다 (세로쓰기)
      var chars = board.text.replace(/\s+/g, '').split('');
      var step = Math.min(17, (h - 26) / Math.max(1, chars.length));
      var startY = y + h / 2 - (step * (chars.length - 1)) / 2;
      ctx.fillStyle = board.fg;
      ctx.font = '700 ' + Math.min(14, step - 2).toFixed(0) + 'px system-ui, sans-serif';
      for (var c = 0; c < chars.length; c++) {
        ctx.fillText(chars[c], x + w / 2, startY + step * c, w - 6);
      }
      if (board.sub) {                       // 부제는 눕혀서 옆에
        ctx.save();
        ctx.translate(x + w - 8, y + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = board.accent;
        ctx.font = '600 8px system-ui, sans-serif';
        ctx.fillText(board.sub, 0, 0, h - 20);
        ctx.restore();
      }
    } else {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = board.fg;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(board.text, 0, -5, h - 18);
      if (board.sub) {
        ctx.fillStyle = board.accent;
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillText(board.sub, 0, 9, h - 18);
      }
    }
    ctx.restore();
    return true;
  }

  /**
   * 그라운드 광고판 (경기장 앞 롤링 보드).
   * x 부터 오른쪽으로 패널을 이어 그린다.
   */
  function drawPerimeter(ctx, x, y, w, h, offset, alpha) {
    var panelW = 210;
    var gap = 10;
    var unit = panelW + gap;
    var start = x - ((offset % unit) + unit) % unit;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    var i = Math.floor(offset / unit);
    for (var px = start; px < x + w + unit; px += unit, i++) {
      var board = pick(i);
      ctx.fillStyle = board.bg;
      roundRect(ctx, px, y, panelW, h, 3);
      ctx.fill();
      ctx.fillStyle = board.accent;
      ctx.fillRect(px, y + h - 3, panelW, 3);
      ctx.fillStyle = board.fg;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(board.text, px + panelW / 2, y + h / 2, panelW - 16);
    }
    ctx.restore();
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  return {
    BOARDS: BOARDS,
    CLICKABLE: CLICKABLE,
    count: count,
    pick: pick,
    hasHangul: hasHangul,
    drawPostBanner: drawPostBanner,
    drawPerimeter: drawPerimeter
  };
});
