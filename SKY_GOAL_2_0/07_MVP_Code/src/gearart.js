/*
 * SKY GOAL 2.0 — 장비 아이콘
 * 12종을 전부 캔버스로 그린다. 이모지를 쓰지 않는 이유는 두 가지다.
 *   1) 이모지는 OS 마다 모양이 달라 "우리 게임의 아이템"으로 보이지 않는다.
 *   2) 같은 슬롯의 4종이 전부 같은 그림이 되어 등급 차이가 눈에 안 들어온다.
 *
 * 40px 에서도 실루엣만으로 구분되도록 형태를 먼저 다르게 잡고 색은 그 다음이다.
 * 브라우저: window.SkyGoalGearArt / Node: module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SkyGoalGearArt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var OUTLINE = '#121a24';

  // 등급이 올라갈수록 금속감이 돈다. 레전더리에만 별을 붙인다.
  var SKINS = {
    boots_practice:  { base: '#9a7549', dark: '#5f4629', trim: '#e3d6bd', star: false },
    boots_mid:       { base: '#2f7fd6', dark: '#1b4c86', trim: '#eaf4ff', star: false },
    boots_striker:   { base: '#e2532b', dark: '#9c3216', trim: '#ffd9a8', star: false },
    boots_silver30:  { base: '#c9d4e0', dark: '#7c8998', trim: '#ffffff', star: true },

    band_cloth:      { base: '#e9edf2', dark: '#a9b4c1', trim: '#5d6b7a', star: false },
    band_captain:    { base: '#f2c53d', dark: '#b3861a', trim: '#3a2d0c', star: false },
    band_ribbon:     { base: '#ff6fa5', dark: '#c23c73', trim: '#ffd7e6', star: false },
    band_captain30:  { base: '#ffce4a', dark: '#b9821a', trim: '#fff3c9', star: true },

    charm_clover:    { base: '#4fbf5a', dark: '#2c7a36', trim: '#a8efae', star: false },
    charm_whistle:   { base: '#b9c4d0', dark: '#75818f', trim: '#eef3f8', star: false },
    charm_gloves:    { base: '#3f8fe0', dark: '#22548c', trim: '#eaf4ff', star: false },
    charm_golden30:  { base: '#ffc93d', dark: '#b07d12', trim: '#fff2c4', star: true },

    // 소모품도 같은 손으로 그린다. 한 화면에 캔버스 아이콘과 이모지가 섞이면
    // 그것만으로 미완성처럼 보인다.
    cons_drink:      { base: '#5fd0c8', dark: '#2b8a84', trim: '#eafffd', star: false },
    cons_taping:     { base: '#f0e6d2', dark: '#b3a488', trim: '#ffffff', star: false },
    cons_scout:      { base: '#8fa4bd', dark: '#4e6076', trim: '#ffffff', star: false },
    cons_home:       { base: '#e2533f', dark: '#9c2d1e', trim: '#ffe3b0', star: false }
  };

  /* ------------------------------------------------------------- 도형 helper */

  function rr(c, x, y, w, h, r) {
    var k = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + k, y);
    c.arcTo(x + w, y, x + w, y + h, k);
    c.arcTo(x + w, y + h, x, y + h, k);
    c.arcTo(x, y + h, x, y, k);
    c.arcTo(x, y, x + w, y, k);
    c.closePath();
  }

  function fillStroke(c, fill, width) {
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = width === undefined ? 1.4 : width;
    c.strokeStyle = OUTLINE;
    c.stroke();
  }

  function star(c, cx, cy, r, fill) {
    c.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = (Math.PI / 5) * i - Math.PI / 2;
      var rad = i % 2 === 0 ? r : r * 0.45;
      var px = cx + Math.cos(ang) * rad;
      var py = cy + Math.sin(ang) * rad;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 0.9;
    c.strokeStyle = OUTLINE;
    c.stroke();
  }

  /* ------------------------------------------------------------- 슬롯별 그림 */

  // 부츠 — 옆에서 본 축구화. 앞코가 길고 뒤축이 올라간다.
  function drawBoot(c, S, sk, id) {
    var u = S / 40;
    c.beginPath();
    c.moveTo(6 * u, 14 * u);
    c.lineTo(16 * u, 12 * u);
    c.quadraticCurveTo(22 * u, 12 * u, 26 * u, 17 * u);
    c.lineTo(34 * u, 23 * u);
    c.quadraticCurveTo(37 * u, 25 * u, 36 * u, 28 * u);
    c.lineTo(7 * u, 28 * u);
    c.quadraticCurveTo(4 * u, 26 * u, 5 * u, 20 * u);
    c.closePath();
    fillStroke(c, sk.base, 1.5 * u);

    // 밑창
    rr(c, 4 * u, 27 * u, 33 * u, 5 * u, 2 * u);
    fillStroke(c, sk.dark, 1.4 * u);

    // 스터드
    c.fillStyle = sk.dark;
    for (var i = 0; i < 4; i++) {
      c.beginPath();
      c.ellipse(9 * u + i * 7.5 * u, 33 * u, 1.6 * u, 1.5 * u, 0, 0, Math.PI * 2);
      c.fill();
    }

    if (id === 'boots_mid') {              // 미드필더 — 옆줄 3선
      c.strokeStyle = sk.trim;
      c.lineWidth = 1.6 * u;
      for (var s = 0; s < 3; s++) {
        c.beginPath();
        c.moveTo((11 + s * 4) * u, 26 * u);
        c.lineTo((14 + s * 4) * u, 17 * u);
        c.stroke();
      }
    } else if (id === 'boots_striker') {   // 스트라이커 — 앞으로 뻗은 속도 핀
      c.beginPath();
      c.moveTo(24 * u, 15 * u);
      c.lineTo(34 * u, 18 * u);
      c.lineTo(25 * u, 20 * u);
      c.closePath();
      fillStroke(c, sk.trim, 1 * u);
    } else if (id === 'boots_practice') {  // 연습장 — 해진 자국
      c.strokeStyle = sk.dark;
      c.lineWidth = 1.2 * u;
      c.beginPath();
      c.moveTo(13 * u, 18 * u); c.lineTo(17 * u, 22 * u);
      c.moveTo(18 * u, 17 * u); c.lineTo(21 * u, 21 * u);
      c.stroke();
    }

    // 끈
    c.strokeStyle = sk.trim;
    c.lineWidth = 1.1 * u;
    c.beginPath();
    c.moveTo(9 * u, 17 * u);
    c.lineTo(15 * u, 15 * u);
    c.stroke();

    if (sk.star) star(c, 29 * u, 12 * u, 6 * u, sk.trim);
  }

  // 암밴드 — 팔에 감긴 띠. 가운데 엠블럼이 등급을 가른다.
  function drawBand(c, S, sk, id) {
    var u = S / 40;
    c.save();
    c.translate(20 * u, 20 * u);
    c.rotate(-0.18);
    rr(c, -15 * u, -9 * u, 30 * u, 18 * u, 4 * u);
    fillStroke(c, sk.base, 1.5 * u);

    // 접힌 주름
    c.strokeStyle = sk.dark;
    c.lineWidth = 1 * u;
    c.beginPath();
    c.moveTo(-15 * u, -4 * u); c.lineTo(15 * u, -4 * u);
    c.moveTo(-15 * u, 4 * u); c.lineTo(15 * u, 4 * u);
    c.stroke();

    if (id === 'band_captain' || id === 'band_captain30') {
      c.beginPath();                       // 주장 표식 C
      c.arc(0, 0, 5.5 * u, 0.5, Math.PI * 2 - 0.5);
      c.lineWidth = 2.4 * u;
      c.strokeStyle = sk.trim;
      c.stroke();
    } else {
      c.beginPath();
      c.arc(0, 0, 4 * u, 0, Math.PI * 2);
      fillStroke(c, sk.trim, 1.1 * u);
    }
    c.restore();
    if (sk.star) star(c, 31 * u, 10 * u, 6 * u, sk.trim);
  }

  // 응원단 리본 — 매듭 하나에 고리 둘, 꼬리 둘. 밴드와 실루엣이 확실히 다르다.
  function drawRibbon(c, S, sk) {
    var u = S / 40;
    c.save();
    c.translate(20 * u, 17 * u);
    // 꼬리
    c.beginPath();
    c.moveTo(-3 * u, 3 * u);
    c.lineTo(-9 * u, 19 * u);
    c.lineTo(-2 * u, 15 * u);
    c.closePath();
    fillStroke(c, sk.dark, 1.2 * u);
    c.beginPath();
    c.moveTo(3 * u, 3 * u);
    c.lineTo(9 * u, 19 * u);
    c.lineTo(2 * u, 15 * u);
    c.closePath();
    fillStroke(c, sk.dark, 1.2 * u);
    // 고리
    c.beginPath();
    c.ellipse(-8.5 * u, -2 * u, 7.5 * u, 5.5 * u, -0.35, 0, Math.PI * 2);
    fillStroke(c, sk.base, 1.4 * u);
    c.beginPath();
    c.ellipse(8.5 * u, -2 * u, 7.5 * u, 5.5 * u, 0.35, 0, Math.PI * 2);
    fillStroke(c, sk.base, 1.4 * u);
    // 매듭
    c.beginPath();
    c.arc(0, 0, 4 * u, 0, Math.PI * 2);
    fillStroke(c, sk.trim, 1.4 * u);
    c.restore();
  }

  // 네잎 클로버
  function drawClover(c, S, sk) {
    var u = S / 40;
    c.save();
    c.translate(20 * u, 18 * u);
    for (var i = 0; i < 4; i++) {
      c.save();
      c.rotate((Math.PI / 2) * i + Math.PI / 4);
      c.beginPath();
      c.ellipse(0, -7.5 * u, 6 * u, 7 * u, 0, 0, Math.PI * 2);
      fillStroke(c, i % 2 ? sk.base : sk.trim, 1.3 * u);
      c.restore();
    }
    c.beginPath();
    c.arc(0, 0, 2.4 * u, 0, Math.PI * 2);
    fillStroke(c, sk.dark, 1 * u);
    c.restore();
    // 줄기
    c.strokeStyle = sk.dark;
    c.lineWidth = 2 * u;
    c.beginPath();
    c.moveTo(20 * u, 26 * u);
    c.quadraticCurveTo(24 * u, 32 * u, 21 * u, 36 * u);
    c.stroke();
  }

  // 호루라기 — 몸통 + 마우스피스 + 고리
  function drawWhistle(c, S, sk) {
    var u = S / 40;
    c.save();
    c.translate(21 * u, 21 * u);
    c.beginPath();                         // 몸통
    c.moveTo(-11 * u, -7 * u);
    c.quadraticCurveTo(9 * u, -9 * u, 11 * u, 0);
    c.quadraticCurveTo(9 * u, 9 * u, -11 * u, 7 * u);
    c.closePath();
    fillStroke(c, sk.base, 1.5 * u);

    c.beginPath();                         // 마우스피스
    rr(c, -19 * u, -3.5 * u, 9 * u, 7 * u, 2 * u);
    fillStroke(c, sk.dark, 1.3 * u);

    c.beginPath();                         // 소리 구멍
    c.arc(3 * u, 0, 3 * u, 0, Math.PI * 2);
    fillStroke(c, sk.dark, 1.1 * u);

    c.beginPath();                         // 고리
    c.arc(9 * u, -9 * u, 3.4 * u, 0, Math.PI * 2);
    c.lineWidth = 1.6 * u;
    c.strokeStyle = sk.trim;
    c.stroke();
    c.restore();
    if (sk.star) star(c, 32 * u, 30 * u, 5.5 * u, sk.trim);
  }

  // 골키퍼 장갑 — 손바닥 + 손가락 넷 + 엄지
  function drawGlove(c, S, sk) {
    var u = S / 40;
    rr(c, 10 * u, 16 * u, 20 * u, 18 * u, 4 * u);   // 손바닥
    fillStroke(c, sk.base, 1.5 * u);
    for (var i = 0; i < 4; i++) {                    // 손가락
      rr(c, (11 + i * 4.6) * u, 6 * u, 3.8 * u, 12 * u, 1.9 * u);
      fillStroke(c, sk.base, 1.3 * u);
    }
    c.save();                                        // 엄지
    c.translate(10 * u, 22 * u);
    c.rotate(-0.5);
    rr(c, -7 * u, -2.2 * u, 8 * u, 4.6 * u, 2.2 * u);
    fillStroke(c, sk.base, 1.3 * u);
    c.restore();
    rr(c, 12 * u, 25 * u, 16 * u, 7 * u, 2 * u);     // 손바닥 패드
    fillStroke(c, sk.trim, 1.1 * u);
  }

  // 워밍업 드링크 — 컵 + 빨대
  function drawDrink(c, S, sk) {
    var u = S / 40;
    c.beginPath();
    c.moveTo(12 * u, 12 * u);
    c.lineTo(28 * u, 12 * u);
    c.lineTo(25 * u, 35 * u);
    c.lineTo(15 * u, 35 * u);
    c.closePath();
    fillStroke(c, sk.base, 1.5 * u);
    rr(c, 10 * u, 9 * u, 20 * u, 5 * u, 2 * u);
    fillStroke(c, sk.trim, 1.3 * u);
    c.strokeStyle = sk.dark;
    c.lineWidth = 2.4 * u;
    c.beginPath();
    c.moveTo(22 * u, 11 * u);
    c.lineTo(27 * u, 4 * u);
    c.stroke();
  }

  // 테이핑 — 감긴 테이프 롤
  function drawTape(c, S, sk) {
    var u = S / 40;
    c.beginPath();
    c.arc(20 * u, 21 * u, 12 * u, 0, Math.PI * 2);
    fillStroke(c, sk.base, 1.5 * u);
    c.beginPath();
    c.arc(20 * u, 21 * u, 5 * u, 0, Math.PI * 2);
    fillStroke(c, sk.dark, 1.3 * u);
    c.strokeStyle = sk.dark;
    c.lineWidth = 1.1 * u;
    c.beginPath();
    c.arc(20 * u, 21 * u, 8.5 * u, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();                       // 풀린 끝단
    c.moveTo(31 * u, 18 * u);
    c.lineTo(38 * u, 24 * u);
    c.lineTo(33 * u, 26 * u);
    c.closePath();
    fillStroke(c, sk.trim, 1.2 * u);
  }

  // 스카우팅 리포트 — 클립보드
  function drawReport(c, S, sk) {
    var u = S / 40;
    rr(c, 9 * u, 8 * u, 22 * u, 27 * u, 3 * u);
    fillStroke(c, sk.base, 1.5 * u);
    rr(c, 15 * u, 4 * u, 10 * u, 6 * u, 2 * u);
    fillStroke(c, sk.dark, 1.3 * u);
    c.strokeStyle = sk.trim;
    c.lineWidth = 1.8 * u;
    for (var i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(13 * u, (17 + i * 5) * u);
      c.lineTo((27 - i * 3) * u, (17 + i * 5) * u);
      c.stroke();
    }
  }

  // 홈 어드밴티지 — 코너 깃발
  function drawFlag(c, S, sk) {
    var u = S / 40;
    c.strokeStyle = sk.dark;
    c.lineWidth = 2.6 * u;
    c.beginPath();
    c.moveTo(13 * u, 6 * u);
    c.lineTo(13 * u, 35 * u);
    c.stroke();
    c.beginPath();
    c.moveTo(14 * u, 7 * u);
    c.lineTo(33 * u, 13 * u);
    c.lineTo(14 * u, 19 * u);
    c.closePath();
    fillStroke(c, sk.base, 1.5 * u);
    c.beginPath();
    c.ellipse(13 * u, 35 * u, 7 * u, 2.6 * u, 0, 0, Math.PI * 2);
    fillStroke(c, sk.trim, 1.2 * u);
  }

  var PAINTERS = {
    boots_practice: drawBoot, boots_mid: drawBoot,
    boots_striker: drawBoot, boots_silver30: drawBoot,
    band_cloth: drawBand, band_captain: drawBand, band_captain30: drawBand,
    band_ribbon: function (c, S, sk) { drawRibbon(c, S, sk); },
    charm_clover: function (c, S, sk) { drawClover(c, S, sk); },
    charm_whistle: function (c, S, sk) { drawWhistle(c, S, sk); },
    charm_golden30: function (c, S, sk) { drawWhistle(c, S, sk); },
    charm_gloves: function (c, S, sk) { drawGlove(c, S, sk); },
    cons_drink: function (c, S, sk) { drawDrink(c, S, sk); },
    cons_taping: function (c, S, sk) { drawTape(c, S, sk); },
    cons_scout: function (c, S, sk) { drawReport(c, S, sk); },
    cons_home: function (c, S, sk) { drawFlag(c, S, sk); }
  };

  /**
   * 아이콘 하나를 (0,0)~(S,S) 안에 그린다.
   * 알 수 없는 id 면 아무것도 그리지 않고 false 를 돌려준다 (게임이 죽지 않게).
   */
  function paint(c, S, id) {
    var sk = SKINS[id];
    var fn = PAINTERS[id];
    if (!c || !sk || !fn) return false;
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    fn(c, S, sk, id);
    c.restore();
    return true;
  }

  return { SKINS: SKINS, paint: paint, ids: Object.keys(SKINS) };
});
