/*
 * SKY GOAL 2.0 — 배경(경치) 렌더러
 * 히말라야 능선 + 강 + 들판을 패럴랙스로 그린다. 스테이지마다 색과 하늘이 바뀐다.
 * 지형은 시드 기반으로 한 번만 생성하므로 매 프레임 모양이 흔들리지 않는다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SkyGoalScenery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 스테이지별 팔레트: 하늘 위/아래, 먼 산, 가까운 산, 강, 숲, 천체
  var PALETTE = {
    DAY:         { sky: ['#3aa5f0', '#cdeeff'], far: '#8aa6c2', near: '#5c7f9f', river: '#63bfe6',
                   forest: '#2f6b46', bank: '#3d7a4e', body: '#fff6d0', bodyGlow: 'rgba(255,246,208,0.35)',
                   haze: 'rgba(255,255,255,0.30)', stars: 0 },
    SUNSET:      { sky: ['#ff6a2a', '#ffd9a0'], far: '#8a5f72', near: '#5a3b52', river: '#ffab5e',
                   forest: '#3c2b3c', bank: '#4b3145', body: '#fff0b8', bodyGlow: 'rgba(255,170,80,0.45)',
                   haze: 'rgba(255,180,120,0.28)', stars: 0.2 },
    NIGHT:       { sky: ['#050d22', '#1b4470'], far: '#1b2c47', near: '#101f36', river: '#2c5382',
                   forest: '#0f2420', bank: '#14301f', body: '#eaf2ff', bodyGlow: 'rgba(220,235,255,0.30)',
                   haze: 'rgba(140,180,230,0.16)', stars: 1 },
    RAIN:        { sky: ['#2a3b4b', '#8296a6'], far: '#4d6070', near: '#394a5b', river: '#5a7381',
                   forest: '#24402f', bank: '#2c4a36', body: null, bodyGlow: null,
                   haze: 'rgba(200,215,225,0.35)', stars: 0 },
    WIND:        { sky: ['#2f6d92', '#d5e9f4'], far: '#71889b', near: '#51677a', river: '#7fb6cc',
                   forest: '#2c5b3f', bank: '#3a6b48', body: '#fdf6df', bodyGlow: 'rgba(253,246,223,0.25)',
                   haze: 'rgba(255,255,255,0.22)', stars: 0 },
    STORM:       { sky: ['#070f19', '#33445a'], far: '#1c2836', near: '#111b26', river: '#233444',
                   forest: '#13221b', bank: '#182c1f', body: null, bodyGlow: null,
                   haze: 'rgba(150,170,190,0.22)', stars: 0.15 },
    WORLD_FINAL: { sky: ['#1a0b2e', '#ff9933'], far: '#4a2a56', near: '#2d1838', river: '#c07a35',
                   forest: '#241640', bank: '#33204a', body: '#fff2c4', bodyGlow: 'rgba(255,200,110,0.45)',
                   haze: 'rgba(255,190,120,0.25)', stars: 0.5 }
  };

  // #rrggbb 를 흰색/검정 쪽으로 섞어 음영을 만든다. amount > 0 이면 밝게, < 0 이면 어둡게.
  function shade(hex, amount) {
    var h = String(hex).replace('#', '');
    if (h.length !== 6) return hex;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var t = amount > 0 ? 255 : 0;
    var k = Math.abs(amount);
    r = Math.round(r + (t - r) * k);
    g = Math.round(g + (t - g) * k);
    b = Math.round(b + (t - b) * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 능선: 좌우로 이어 붙여도 끊기지 않도록 첫 점과 끝 점의 높이를 맞춘다.
  // 봉우리마다 좌우 경사가 다르고, 사이사이에 잔 굴곡을 넣어 실루엣이 단조롭지 않게 한다.
  function ridge(rand, width, points, baseY, height, roughness) {
    var key = [];
    var first = baseY - height * (0.45 + rand() * 0.4);
    for (var i = 0; i <= points; i++) {
      var y;
      if (i === 0 || i === points) {
        y = first;
      } else {
        var peak = rand() < roughness ? 0.55 + rand() * 0.45 : 0.2 + rand() * 0.3;
        y = baseY - height * peak;
      }
      key.push({ x: (width * i) / points, y: y, peak: i !== 0 && i !== points });
    }

    // 각 구간을 잘게 쪼개고 지그재그를 더한다 (바위 능선 느낌)
    var pts = [];
    var sub = 4;
    for (var k = 0; k < key.length - 1; k++) {
      var a = key[k], b = key[k + 1];
      for (var j = 0; j < sub; j++) {
        var t = j / sub;
        var x = a.x + (b.x - a.x) * t;
        var y2 = a.y + (b.y - a.y) * t;
        if (j > 0) {
          var bump = (rand() - 0.5) * height * 0.10 * Math.sin(Math.PI * t);
          y2 += bump;
        }
        pts.push({ x: x, y: y2, peak: j === 0 && a.peak });
      }
    }
    pts.push({ x: key[key.length - 1].x, y: key[key.length - 1].y, peak: false });
    return pts;
  }

  // 나무 한 그루 (침엽수 / 활엽수)
  function drawTree(ctx, x, baseY, h, kind, body, dark) {
    var w = h * 0.42;
    ctx.fillStyle = body;
    if (kind === 0) {                                   // 침엽수
      for (var s2 = 0; s2 < 3; s2++) {
        var ty = baseY - h * (0.30 + s2 * 0.26);
        var tw = w * (1 - s2 * 0.22);
        ctx.beginPath();
        ctx.moveTo(x, ty - h * 0.34);
        ctx.lineTo(x + tw / 2, ty);
        ctx.lineTo(x - tw / 2, ty);
        ctx.closePath();
        ctx.fill();
      }
    } else {                                            // 활엽수
      ctx.beginPath();
      ctx.arc(x, baseY - h * 0.62, w * 0.62, 0, Math.PI * 2);
      ctx.arc(x - w * 0.38, baseY - h * 0.46, w * 0.44, 0, Math.PI * 2);
      ctx.arc(x + w * 0.38, baseY - h * 0.48, w * 0.46, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = dark;
    ctx.fillRect(x - Math.max(1, w * 0.07), baseY - h * 0.34, Math.max(1.5, w * 0.14), h * 0.34);
  }

  function create(seed) {
    var rand = mulberry32(seed || 20300101);
    var W = 0, H = 0, groundY = 0;
    var layers = null;
    var stars = [];
    var clouds = [];
    var birds = [];

    function resize(width, height, ground) {
      W = width; H = height; groundY = ground;
      var span = Math.max(640, W * 1.6);          // 반복 단위 폭
      var horizon = groundY - Math.max(120, H * 0.19);
      var r = mulberry32(seed || 20300101);       // 리사이즈해도 같은 지형

      var riverTop = groundY - Math.max(76, H * 0.115);
      layers = {
        span: span,
        horizon: horizon,
        riverTop: riverTop,
        riverBottom: groundY - Math.max(30, H * 0.05),
        far: ridge(r, span, 11, horizon, Math.max(150, H * 0.30), 0.55),
        mid: ridge(r, span, 8, horizon + 14, Math.max(120, H * 0.23), 0.45),
        near: ridge(r, span, 9, horizon + 26, Math.max(90, H * 0.17), 0.35),
        forest: ridge(r, span, 26, horizon + 58, Math.max(34, H * 0.055), 0.8),
        trees: []
      };

      // 강 건너 숲 — 나무를 한 그루씩 세운다
      var treeBase = riverTop + 2;
      for (var t2 = 0; t2 < Math.round(span / 13); t2++) {
        layers.trees.push({
          x: r() * span,
          h: 12 + r() * 20,
          kind: r() < 0.62 ? 0 : 1,
          shade: 0.75 + r() * 0.5,
          baseY: treeBase - r() * 8
        });
      }
      layers.trees.sort(function (a, b) { return a.h - b.h; });

      stars = [];
      for (var i = 0; i < 70; i++) {
        stars.push({ x: r() * span, y: r() * horizon * 0.8, s: 0.6 + r() * 1.4, tw: r() * 6.28 });
      }
      clouds = [];
      for (var c = 0; c < 6; c++) {
        clouds.push({ x: r() * span, y: horizon * (0.12 + r() * 0.5), w: 90 + r() * 150, h: 16 + r() * 20 });
      }
      birds = [];
      for (var b = 0; b < 4; b++) {
        birds.push({ x: r() * span, y: horizon * (0.25 + r() * 0.35), s: 5 + r() * 4, ph: r() * 6.28 });
      }
    }

    function paletteFor(key) {
      return PALETTE[key] || PALETTE.DAY;
    }

    // 한 레이어를 화면 폭만큼 반복해서 그린다.
    // top→bottom 그라디언트로 채워 산이 평평한 색 덩어리로 보이지 않게 한다.
    function fillRidge(ctx, pts, offset, bottom, color, lit) {
      var span = layers.span;
      var shift = -(offset % span);
      var topY = bottom;
      for (var t = 0; t < pts.length; t++) topY = Math.min(topY, pts[t].y);

      var grad = ctx.createLinearGradient(0, topY, 0, bottom);
      grad.addColorStop(0, shade(color, 0.16));
      grad.addColorStop(0.45, color);
      grad.addColorStop(1, shade(color, -0.28));
      ctx.fillStyle = grad;

      for (var pass = 0; pass < Math.ceil(W / span) + 2; pass++) {
        var base = shift + pass * span;
        ctx.beginPath();
        ctx.moveTo(base + pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(base + pts[i].x, pts[i].y);
        ctx.lineTo(base + span, bottom);
        ctx.lineTo(base, bottom);
        ctx.closePath();
        ctx.fill();

        // 봉우리 오른쪽 사면에 그림자 삼각형을 얹어 입체감을 만든다.
        // 능선을 따라 내려가다 멈추므로 산 안쪽에 세로줄이 생기지 않는다.
        if (lit) {
          ctx.fillStyle = 'rgba(20,30,45,0.17)';
          for (var k = 1; k < pts.length - 2; k++) {
            var p0 = pts[k];
            if (!p0.peak) continue;
            var e = Math.min(pts.length - 1, k + 4);
            var p1 = pts[e];
            if (p1.y <= p0.y) continue;                  // 내리막이 아니면 건너뛴다
            ctx.beginPath();
            ctx.moveTo(base + p0.x, p0.y);
            for (var m = k + 1; m <= e; m++) ctx.lineTo(base + pts[m].x, pts[m].y);
            ctx.lineTo(base + p0.x, p1.y);
            ctx.closePath();
            ctx.fill();
          }
          ctx.fillStyle = grad;
        }
      }
    }

    // 숲 — 나무를 한 그루씩
    function drawTrees(ctx, offset, color) {
      var span = layers.span;
      var trees = layers.trees;
      var dark = shade(color, -0.35);
      for (var i = 0; i < trees.length; i++) {
        var t = trees[i];
        var x = (t.x - offset) % span;
        if (x < 0) x += span;
        if (x < -30 || x > W + 30) continue;
        drawTree(ctx, x, t.baseY, t.h, t.kind, shade(color, (t.shade - 1) * 0.35), dark);
      }
    }

    function snowCaps(ctx, pts, offset, color) {
      var span = layers.span;
      var shift = -(offset % span);
      ctx.fillStyle = color;
      for (var pass = 0; pass < Math.ceil(W / span) + 2; pass++) {
        var base = shift + pass * span;
        for (var i = 1; i < pts.length - 1; i++) {
          var p = pts[i], a = pts[i - 1], b = pts[i + 1];
          if (p.y < a.y && p.y < b.y) {                   // 봉우리에만 만년설
            var drop = Math.min(28, (Math.min(a.y, b.y) - p.y) * 0.55);
            if (drop < 6) continue;
            ctx.beginPath();
            ctx.moveTo(base + p.x, p.y);
            ctx.lineTo(base + p.x + drop * 0.9, p.y + drop);
            ctx.lineTo(base + p.x - drop * 0.9, p.y + drop);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }

    /**
     * opts = { stage: 'NIGHT', scroll: number, time: seconds, flash: 0~1 }
     */
    function draw(ctx, opts) {
      if (!layers) return;
      var p = paletteFor(opts.stage);
      var scroll = opts.scroll || 0;
      var t = opts.time || 0;
      var L = layers;

      // 하늘
      var g = ctx.createLinearGradient(0, 0, 0, groundY);
      g.addColorStop(0, p.sky[0]);
      g.addColorStop(1, p.sky[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 별
      if (p.stars > 0) {
        for (var s = 0; s < stars.length; s++) {
          var st = stars[s];
          var x = (st.x - scroll * 0.02) % L.span;
          if (x < 0) x += L.span;
          if (x > W) continue;
          var tw = 0.55 + 0.45 * Math.sin(t * 2 + st.tw);
          ctx.fillStyle = 'rgba(255,255,255,' + (p.stars * tw * 0.9).toFixed(3) + ')';
          ctx.fillRect(x, st.y, st.s, st.s);
        }
      }

      // 해 / 달
      if (p.body) {
        var bx = W * 0.74, by = L.horizon * 0.42;
        var glow = ctx.createRadialGradient(bx, by, 4, bx, by, 96);
        glow.addColorStop(0, p.bodyGlow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(bx - 100, by - 100, 200, 200);
        ctx.fillStyle = p.body;
        ctx.beginPath();
        ctx.arc(bx, by, opts.stage === 'SUNSET' ? 34 : 24, 0, Math.PI * 2);
        ctx.fill();
      }

      // 구름 — 크기가 다른 덩어리를 겹쳐 가장자리를 뭉갠다
      for (var c = 0; c < clouds.length; c++) {
        var cl = clouds[c];
        var cx = (cl.x - scroll * 0.03) % L.span;
        if (cx < 0) cx += L.span;
        if (cx > W + cl.w || cx < -cl.w) continue;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = p.haze;
        var blobs = [
          [0, 0, 0.50, 1.00], [0.26, 0.22, 0.32, 0.72], [-0.28, 0.18, 0.30, 0.66],
          [0.10, -0.30, 0.26, 0.60], [-0.10, 0.34, 0.34, 0.52]
        ];
        for (var q = 0; q < blobs.length; q++) {
          ctx.beginPath();
          ctx.ellipse(cx + cl.w * blobs[q][0], cl.y + cl.h * blobs[q][1],
                      cl.w * blobs[q][2], cl.h * blobs[q][3], 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.35;                    // 아랫면 그늘
        ctx.fillStyle = 'rgba(40,60,90,0.30)';
        ctx.beginPath();
        ctx.ellipse(cx, cl.y + cl.h * 0.55, cl.w * 0.42, cl.h * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 새 (맑은 스테이지에만)
      if (p.stars === 0 && opts.stage !== 'RAIN') {
        ctx.strokeStyle = 'rgba(30,40,55,0.35)';
        ctx.lineWidth = 1.5;
        for (var b = 0; b < birds.length; b++) {
          var bd = birds[b];
          var bxx = (bd.x - scroll * 0.05 - t * 14) % L.span;
          if (bxx < 0) bxx += L.span;
          if (bxx > W) continue;
          var flap = Math.sin(t * 6 + bd.ph) * bd.s * 0.5;
          ctx.beginPath();
          ctx.moveTo(bxx - bd.s, bd.y + flap);
          ctx.lineTo(bxx, bd.y);
          ctx.lineTo(bxx + bd.s, bd.y + flap);
          ctx.stroke();
        }
      }

      // 산줄기 — 멀수록 흐리고 밝게(대기 원근), 가까울수록 진하고 입체적으로
      fillRidge(ctx, L.far, scroll * 0.06, L.riverTop, shade(p.far, 0.14));
      snowCaps(ctx, L.far, scroll * 0.06, 'rgba(255,255,255,0.62)');

      ctx.save();                                   // 먼 산 위에 옅은 안개
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.haze;
      ctx.fillRect(0, L.horizon - Math.max(150, H * 0.30), W, L.riverTop - L.horizon + Math.max(150, H * 0.30));
      ctx.restore();

      if (L.mid) {
        fillRidge(ctx, L.mid, scroll * 0.09, L.riverTop, p.far, true);
        snowCaps(ctx, L.mid, scroll * 0.09, 'rgba(255,255,255,0.40)');
      }
      fillRidge(ctx, L.near, scroll * 0.12, L.riverTop, p.near, true);

      // 대기 원근감 — 산 아랫부분이 강 쪽으로 갈수록 흐려진다
      var hz = ctx.createLinearGradient(0, L.horizon - 20, 0, L.riverTop);
      hz.addColorStop(0, 'rgba(255,255,255,0)');
      hz.addColorStop(1, p.haze);
      ctx.fillStyle = hz;
      ctx.fillRect(0, L.horizon - 20, W, L.riverTop - L.horizon + 20);

      // 강 건너 숲 — 능선으로 바닥을 깔고 그 위에 나무를 세운다
      fillRidge(ctx, L.forest, scroll * 0.22, L.riverTop, p.forest);
      if (L.trees) drawTrees(ctx, scroll * 0.22, p.forest);

      // 강 — 위쪽은 건너편 그림자, 가운데는 하늘 반사, 아래는 다시 물빛
      var rg = ctx.createLinearGradient(0, L.riverTop, 0, L.riverBottom);
      rg.addColorStop(0, shade(p.river, -0.35));
      rg.addColorStop(0.30, p.river);
      rg.addColorStop(0.62, shade(p.sky[1], -0.05));
      rg.addColorStop(1, shade(p.river, -0.12));
      ctx.fillStyle = rg;
      ctx.fillRect(0, L.riverTop, W, L.riverBottom - L.riverTop);

      // 능선의 흐릿한 반영
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, L.riverTop, W, (L.riverBottom - L.riverTop) * 0.55);
      ctx.clip();
      ctx.globalAlpha = 0.22;
      ctx.translate(0, L.riverTop * 2 + 6);
      ctx.scale(1, -0.32);
      fillRidge(ctx, L.near, scroll * 0.12, L.riverTop, shade(p.near, -0.2));
      ctx.restore();

      // 해/달의 물 반사 — 가장자리를 부드럽게 흘린다
      if (p.body) {
        var refX = W * 0.74;
        var refW = 74;
        var ref = ctx.createLinearGradient(refX - refW / 2, 0, refX + refW / 2, 0);
        ref.addColorStop(0, 'rgba(0,0,0,0)');
        ref.addColorStop(0.5, p.bodyGlow);
        ref.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ref;
        for (var rr = 0; rr < 6; rr++) {
          var ry0 = L.riverTop + (rr / 6) * (L.riverBottom - L.riverTop);
          var wob = Math.sin(t * 1.6 + rr * 1.1) * (3 + rr * 1.6);
          ctx.globalAlpha = 0.85 - rr * 0.1;
          ctx.fillRect(refX - refW / 2 + wob, ry0, refW, (L.riverBottom - L.riverTop) / 6 - 1);
        }
        ctx.globalAlpha = 1;
      }

      // 물비늘
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = 1;
      var rows = 5;
      for (var r2 = 0; r2 < rows; r2++) {
        var ry = L.riverTop + ((r2 + 0.5) / rows) * (L.riverBottom - L.riverTop);
        var speed = 12 + r2 * 9;
        for (var k = 0; k < 7; k++) {
          var sx = ((k * 160 + t * speed + r2 * 45 - scroll * 0.35) % (W + 180)) - 90;
          var len = 26 + (r2 % 3) * 12;
          ctx.beginPath();
          ctx.moveTo(sx, ry + Math.sin(t * 2 + k + r2) * 1.6);
          ctx.lineTo(sx + len, ry + Math.sin(t * 2 + k + r2 + 1) * 1.6);
          ctx.stroke();
        }
      }

      // 앞쪽 강둑
      ctx.fillStyle = p.bank;
      ctx.fillRect(0, L.riverBottom, W, groundY - L.riverBottom);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, L.riverBottom, W, 4);

      // 번개 (STORM)
      if (opts.flash > 0) {
        ctx.fillStyle = 'rgba(210,230,255,' + (opts.flash * 0.55).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }

    return {
      resize: resize,
      draw: draw,
      paletteFor: paletteFor,
      layout: function () { return layers; }
    };
  }

  return { create: create, PALETTE: PALETTE, mulberry32: mulberry32 };
});
