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
    { id: 'india2030', kind: 'house', mark: 'star', text: 'INDIA 2030',
      sub: 'ONE DREAM · ONE NATION', bg: '#12233f', fg: '#ffffff', accent: '#ff9933' },
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
   * 대형 세로 광고판 — 타워형 간판. 좁고 높아서 하늘 쪽으로 뻗는다.
   * 한글은 세로쓰기, 영문은 눕혀서 표시한다(기둥 배너와 같은 규칙).
   */
  function drawTowerBillboard(ctx, board, x, baseY, w, h, alpha) {
    if (!board || h < 110) return false;
    var legH = Math.max(14, h * 0.10);
    var top = baseY - legH - h;

    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    // 지지대 (가운데 기둥 + 버팀대)
    ctx.fillStyle = 'rgba(30,40,54,0.85)';
    ctx.fillRect(x + w / 2 - Math.max(3, w * 0.06), baseY - legH, Math.max(6, w * 0.12), legH);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.1, baseY);
    ctx.lineTo(x + w / 2, baseY - legH);
    ctx.lineTo(x + w * 0.9, baseY);
    ctx.lineTo(x + w * 0.78, baseY);
    ctx.lineTo(x + w / 2, baseY - legH * 0.55);
    ctx.lineTo(x + w * 0.22, baseY);
    ctx.closePath();
    ctx.fill();

    // 패널
    ctx.fillStyle = board.bg;
    roundRect(ctx, x, top, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = board.accent;
    ctx.fillRect(x + 5, top + 6, w - 10, 4);
    ctx.fillRect(x + 5, top + h - 10, w - 10, 4);

    // 로고 (위쪽) + 문구 (아래 영역)
    var markR = Math.min(w * 0.30, 22);
    drawMark(ctx, board.mark || 'shield', x + w / 2, top + 18 + markR, markR,
             board.accent, board.bg);
    var ty = top + 26 + markR * 2;
    var th = h - (ty - top) - 16;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (hasHangul(board.text)) {
      var chars = board.text.replace(/\s+/g, '').split('');
      var step = Math.min(w * 0.72, th / Math.max(1, chars.length));
      var startY = ty + th / 2 - (step * (chars.length - 1)) / 2;
      ctx.fillStyle = board.fg;
      ctx.font = '800 ' + Math.min(w * 0.62, step - 3).toFixed(0) + 'px system-ui, sans-serif';
      for (var c = 0; c < chars.length; c++) {
        ctx.fillText(chars[c], x + w / 2, startY + step * c, w - 8);
      }
    } else {
      ctx.save();
      ctx.translate(x + w / 2, ty + th / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = board.fg;
      ctx.font = '800 ' + Math.round(w * 0.34) + 'px system-ui, sans-serif';
      ctx.fillText(board.text, 0, board.sub ? -w * 0.16 : 0, th - 12);
      if (board.sub) {
        ctx.fillStyle = board.accent;
        ctx.font = '600 ' + Math.round(w * 0.19) + 'px system-ui, sans-serif';
        ctx.fillText(board.sub, 0, w * 0.20, th - 12);
      }
      ctx.restore();
    }

    // 상단 조명
    ctx.fillStyle = 'rgba(255,240,200,0.85)';
    ctx.fillRect(x + w / 2 - 4, top - 7, 8, 5);
    var glow = ctx.createLinearGradient(0, top - 6, 0, top + h * 0.45);
    glow.addColorStop(0, 'rgba(255,240,200,0.20)');
    glow.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 5, top - 4);
    ctx.lineTo(x + w / 2 + 5, top - 4);
    ctx.lineTo(x + w * 0.95, top + h * 0.45);
    ctx.lineTo(x + w * 0.05, top + h * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
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
      if (board.mark) drawMark(ctx, board.mark, px + 14, y + h / 2, 5.5, board.accent, board.bg);
      ctx.fillStyle = board.fg;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(board.text, px + panelW / 2 + 8, y + h / 2, panelW - 34);
    }
    ctx.restore();
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  return {
    BOARDS: BOARDS,
    CLICKABLE: CLICKABLE,
    ORDER: ORDER,
    count: count,
    pick: pick,
    boardsOfKind: boardsOfKind,
    drawMark: drawMark,
    hasHangul: hasHangul,
    drawPostBanner: drawPostBanner,
    drawTowerBillboard: drawTowerBillboard,
    drawPerimeter: drawPerimeter
  };
});
