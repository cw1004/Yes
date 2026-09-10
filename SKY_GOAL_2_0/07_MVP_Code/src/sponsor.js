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

  /*
   * kind
   *   house    자체 홍보 (게임 기능·브랜드 메시지)
   *   sponsor  광고 지면. 지금은 전부 **가상 브랜드**다.
   *            실존 상표를 쓰지 않고, 이 프로젝트의 자체 IP(GAJU/GABE 등)와
   *            일반 명사를 조합해 만들었다. 실제 스폰서가 붙으면 이 항목을 교체한다.
   *   campaign 공익 캠페인. 광고와 광고 사이에 끼워 넣어 화면이 상업적으로만
   *            보이지 않게 하고, 브랜드 톤도 지킨다.
   * mark  배너 상단에 그려지는 로고 마크 (ball/boot/leaf/drop/star/shield/cup)
   */
  var BOARDS = [
    // ── 자체 홍보 ────────────────────────────────────────────────
    { id: 'promode', kind: 'house', mark: 'star', text: 'PRO MODE',
      sub: '좁은 골문 · 보상 1.6배', bg: '#2b1230', fg: '#ffffff', accent: '#ff6fae' },
    { id: 'shop', kind: 'house', mark: 'ball', text: '새 공 만나기',
      sub: 'BALL SHOP', bg: '#2a1a3f', fg: '#ffffff', accent: '#ffd75a' },
    { id: 'follow', kind: 'house', mark: 'shield', text: 'FOLLOW THE DREAM',
      sub: '2030', bg: '#3a1f14', fg: '#ffffff', accent: '#ff9933' },

    // ── 가상 브랜드 광고 (실존 상표 아님) ────────────────────────
    { id: 'gaju', kind: 'sponsor', fictional: true, mark: 'boot', text: 'GAJU SPORTS',
      sub: 'FOOTBALL GEAR', bg: '#14304a', fg: '#ffffff', accent: '#4db3ff' },
    { id: 'gabe', kind: 'sponsor', fictional: true, mark: 'cup', text: 'GABE ENERGY',
      sub: 'PLAY LONGER', bg: '#3d1030', fg: '#ffffff', accent: '#ff5fa2' },
    { id: 'academy', kind: 'sponsor', fictional: true, mark: 'shield', text: 'SKY GOAL ACADEMY',
      sub: 'JOIN THE CLASS', bg: '#10303a', fg: '#ffffff', accent: '#5ad0c0' },
    { id: 'dreamboots', kind: 'sponsor', fictional: true, mark: 'boot', text: 'DREAM BOOTS',
      sub: 'MADE FOR MUD', bg: '#31240f', fg: '#ffffff', accent: '#ffc44d' },
    { id: 'slot', kind: 'sponsor', text: 'YOUR BRAND HERE', mark: 'shield',
      sub: 'sponsor@skygoal', bg: '#1b2431', fg: '#c9d6e6', accent: '#8fa6c0' },

    // ── 공익 캠페인 ──────────────────────────────────────────────
    { id: 'earth', kind: 'campaign', mark: 'globe', text: '지구 살리기 운동',
      sub: 'SAVE OUR EARTH', bg: '#0d3348', fg: '#ffffff', accent: '#5ad0c0' },
    { id: 'nature', kind: 'campaign', mark: 'leaf', text: '자연을 지켜요',
      sub: 'PROTECT NATURE', bg: '#123a2a', fg: '#ffffff', accent: '#7ee08a' },
    { id: 'eco', kind: 'campaign', mark: 'leaf', text: '생태를 지키자',
      sub: 'SAVE OUR ECOSYSTEM', bg: '#0f3324', fg: '#ffffff', accent: '#5ad07a' },
    { id: 'creation', kind: 'campaign', mark: 'shield', text: '창조 질서 보전',
      sub: 'CARE FOR CREATION', bg: '#1a2c46', fg: '#ffffff', accent: '#9fd8ff' },
    { id: 'water', kind: 'campaign', mark: 'drop', text: '물을 아껴요',
      sub: 'SAVE WATER', bg: '#0e2b3d', fg: '#ffffff', accent: '#6fd0ff' },
    { id: 'tree', kind: 'campaign', mark: 'leaf', text: '나무 한 그루',
      sub: 'PLANT A TREE', bg: '#1c3312', fg: '#ffffff', accent: '#a5e05a' }
  ];

  // 광고만 줄줄이 나오지 않도록 종류를 섞은 순서를 만든다.
  // 대략 광고 2개마다 캠페인 1개, 그 사이에 자체 홍보가 들어간다.
  function buildOrder(list) {
    var by = { house: [], sponsor: [], campaign: [] };
    for (var i = 0; i < list.length; i++) {
      (by[list[i].kind] || by.house).push(list[i]);
    }
    var order = [];
    var idx = { house: 0, sponsor: 0, campaign: 0 };
    var pattern = ['sponsor', 'campaign', 'sponsor', 'house', 'campaign', 'sponsor', 'house'];
    var guard = 0;
    while (order.length < list.length && guard++ < 200) {
      for (var p = 0; p < pattern.length && order.length < list.length; p++) {
        var kind = pattern[p];
        var pool = by[kind];
        if (!pool.length) continue;
        var item = pool[idx[kind] % pool.length];
        idx[kind]++;
        if (order.indexOf(item) < 0) order.push(item);
      }
      // 남은 것이 있으면 채운다
      for (var r = 0; r < list.length; r++) {
        if (order.length >= list.length) break;
        if (order.indexOf(list[r]) < 0 && idx.sponsor + idx.campaign + idx.house > list.length * 2) {
          order.push(list[r]);
        }
      }
    }
    return order;
  }

  var ORDER = buildOrder(BOARDS);

  function count() { return ORDER.length; }

  // 골문마다 다른 보드가 걸리도록 섞인 순서대로 돌린다.
  function pick(index) {
    var n = ORDER.length;
    if (!n) return null;
    var i = Math.floor(Math.abs(index || 0)) % n;
    return ORDER[i];
  }

  function boardsOfKind(kind) {
    return BOARDS.filter(function (b) { return b.kind === kind; });
  }

  var INTRO_BOARD = 'earth';                 // 경기 시작 전에 거는 캠페인 보드

  function boardById(id) {
    for (var i = 0; i < BOARDS.length; i++) if (BOARDS[i].id === id) return BOARDS[i];
    return null;
  }

  function introBoard() {
    return boardById(INTRO_BOARD) || pickKind('campaign', 0);
  }

  // 특정 종류 안에서만 순환한다 (예: 캠페인 표지판)
  function pickKind(kind, index) {
    var pool = boardsOfKind(kind);
    if (!pool.length) return null;
    var i = Math.floor(Math.abs(index || 0)) % pool.length;
    return pool[i];
  }

  /**
   * 배너 상단 로고 마크. 전부 자체 제작 도형이며 실존 상표를 본뜨지 않는다.
   * type: ball / boot / leaf / drop / star / shield / cup
   */
  function drawMark(ctx, type, cx, cy, r, color, bg) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (type === 'ball') {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (var i = 0; i < 5; i++) {
        var a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
      }
      ctx.closePath(); ctx.fill();
    } else if (type === 'boot') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(-r * 0.15, -r * 0.7);
      ctx.lineTo(-r * 0.05, r * 0.1);
      ctx.lineTo(r * 0.85, r * 0.35);
      ctx.lineTo(r * 0.85, r * 0.7);
      ctx.lineTo(-r * 0.7, r * 0.7);
      ctx.closePath(); ctx.fill();
      if (bg) {
        ctx.fillStyle = bg;
        for (var st = 0; st < 3; st++) {
          ctx.fillRect(-r * 0.1 + st * r * 0.3, r * 0.72, r * 0.12, r * 0.2);
        }
      }
    } else if (type === 'leaf') {
      ctx.beginPath();
      ctx.moveTo(0, r);
      ctx.quadraticCurveTo(-r, r * 0.2, 0, -r);
      ctx.quadraticCurveTo(r, r * 0.2, 0, r);
      ctx.closePath(); ctx.fill();
      if (bg) {
        ctx.strokeStyle = bg;
        ctx.lineWidth = Math.max(1, r * 0.14);
        ctx.beginPath(); ctx.moveTo(0, r * 0.8); ctx.lineTo(0, -r * 0.7); ctx.stroke();
      }
    } else if (type === 'drop') {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r, r * 0.1, 0, r);
      ctx.quadraticCurveTo(-r, r * 0.1, 0, -r);
      ctx.closePath(); ctx.fill();
      if (bg) {
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(-r * 0.25, r * 0.25, r * 0.18, 0, Math.PI * 2); ctx.fill();
      }
    } else if (type === 'star') {
      ctx.beginPath();
      for (var k = 0; k < 10; k++) {
        var ang = (Math.PI / 5) * k - Math.PI / 2;
        var rad2 = k % 2 === 0 ? r : r * 0.44;
        ctx.lineTo(Math.cos(ang) * rad2, Math.sin(ang) * rad2);
      }
      ctx.closePath(); ctx.fill();
    } else if (type === 'cup') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.8);
      ctx.lineTo(r * 0.55, -r * 0.8);
      ctx.lineTo(r * 0.35, r * 0.25);
      ctx.lineTo(-r * 0.35, r * 0.25);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, r * 0.25); ctx.lineTo(0, r * 0.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.85); ctx.lineTo(r * 0.5, r * 0.85); ctx.stroke();
    } else if (type === 'globe') {             // 지구
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      if (bg) {
        ctx.strokeStyle = bg;
        ctx.lineWidth = Math.max(1.2, r * 0.16);
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.45, r, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.5, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    } else {                                   // shield (기본)
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.8);
      ctx.lineTo(r * 0.8, -r * 0.8);
      ctx.lineTo(r * 0.8, r * 0.15);
      ctx.quadraticCurveTo(r * 0.8, r, 0, r);
      ctx.quadraticCurveTo(-r * 0.8, r, -r * 0.8, r * 0.15);
      ctx.closePath(); ctx.fill();
      if (bg) {
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
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

    // 로고 마크
    var markR = Math.min((w - 14) / 2, 12);
    var markH = 0;
    if (board.mark && h > 100) {
      markH = markR * 2 + 8;
      drawMark(ctx, board.mark, x + w / 2, y + 12 + markR, markR, board.accent, board.bg);
    }
    var ty = y + markH;
    var th = h - markH;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (hasHangul(board.text)) {
      // 한글은 눕히면 읽기 어렵다 — 글자를 세로로 쌓는다 (세로쓰기)
      var chars = board.text.replace(/\s+/g, '').split('');
      var step = Math.min(17, (th - 26) / Math.max(1, chars.length));
      var startY = ty + th / 2 - (step * (chars.length - 1)) / 2;
      ctx.fillStyle = board.fg;
      ctx.font = '700 ' + Math.min(14, step - 2).toFixed(0) + 'px system-ui, sans-serif';
      for (var c = 0; c < chars.length; c++) {
        ctx.fillText(chars[c], x + w / 2, startY + step * c, w - 6);
      }
      if (board.sub) {                       // 부제는 눕혀서 옆에
        ctx.save();
        ctx.translate(x + w - 8, ty + th / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = board.accent;
        ctx.font = '600 8px system-ui, sans-serif';
        ctx.fillText(board.sub, 0, 0, th - 20);
        ctx.restore();
      }
    } else {
      ctx.translate(x + w / 2, ty + th / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = board.fg;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillText(board.text, 0, -5, th - 18);
      if (board.sub) {
        ctx.fillStyle = board.accent;
        ctx.font = '600 9px system-ui, sans-serif';
        ctx.fillText(board.sub, 0, 9, th - 18);
      }
    }
    ctx.restore();
    return true;
  }

  /**
   * 작은 가로 표지판 — 자연보호 캠페인용.
   * 대형 간판 사이 중간에 낮게 놓여, 광고가 아니라 안내판처럼 보이게 한다.
   */
  function drawSignBoard(ctx, board, x, baseY, w, h, alpha, floating) {
    if (!board || w < 80) return false;
    var legH = floating ? 0 : Math.max(10, h * 0.42);
    var top = baseY - legH - h;

    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    if (floating) {
      // 공중에 걸린 현수막 — 기둥 대신 짧은 걸이줄과 그림자
      ctx.strokeStyle = 'rgba(230,240,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x + w * 0.2, top); ctx.lineTo(x + w * 0.2, top - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w * 0.8, top); ctx.lineTo(x + w * 0.8, top - 10); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      roundRect(ctx, x + 4, top + 5, w, h, 4);
      ctx.fill();
    } else {
      // 나무 기둥 두 개
      ctx.fillStyle = 'rgba(62,48,34,0.9)';
      ctx.fillRect(x + w * 0.16, top + h - 2, Math.max(3, w * 0.045), legH + 2);
      ctx.fillRect(x + w * 0.80, top + h - 2, Math.max(3, w * 0.045), legH + 2);
    }

    // 판
    ctx.fillStyle = board.bg;
    roundRect(ctx, x, top, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = board.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 로고 + 문구 (한 줄)
    var markR = Math.min(h * 0.30, w * 0.09);
    drawMark(ctx, board.mark || 'leaf', x + 10 + markR, top + h * 0.5, markR,
             board.accent, board.bg);
    var tx = x + 16 + markR * 2;
    var tw = w - (tx - x) - 8;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = board.fg;
    ctx.font = '700 ' + Math.round(h * 0.34) + 'px system-ui, sans-serif';
    ctx.fillText(board.text, tx, top + h * (board.sub ? 0.38 : 0.5), tw);
    if (board.sub && h > 26) {
      ctx.fillStyle = board.accent;
      ctx.font = '600 ' + Math.round(h * 0.22) + 'px system-ui, sans-serif';
      ctx.fillText(board.sub, tx, top + h * 0.72, tw);
    }

    ctx.restore();
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    return true;
  }

  return {
    BOARDS: BOARDS,
    CLICKABLE: CLICKABLE,
    ORDER: ORDER,
    count: count,
    pick: pick,
    boardsOfKind: boardsOfKind,
    pickKind: pickKind,
    boardById: boardById,
    introBoard: introBoard,
    INTRO_BOARD: INTRO_BOARD,
    drawMark: drawMark,
    hasHangul: hasHangul,
    drawPostBanner: drawPostBanner,
    drawSignBoard: drawSignBoard
  };
});
