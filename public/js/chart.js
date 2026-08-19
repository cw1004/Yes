/**
 * ScalpChart — 의존성 없는 캔버스 캔들차트.
 * 메인 패널(캔들 + 이동평균선 + 볼린저밴드 + VWAP + 추세선 + 지지/저항 + 피보나치)과
 * 거래량 / RSI / MACD / 스토캐스틱 서브패널을 하나의 캔버스에 그린다.
 *
 * 상호작용: 휠 확대·축소, 드래그 이동, 십자선 툴팁, 추세선 직접 그리기, 더블클릭 리셋.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    timeZone: 'America/New_York',
    padding: { top: 10, right: 66, bottom: 22, left: 8 },
    minBars: 20,
    maxBars: 1200,
    colors: {
      bg: '#0e1117',
      grid: 'rgba(255,255,255,0.05)',
      axis: '#8b93a7',
      text: '#c7cede',
      up: '#26a17b',
      down: '#e2544c',
      upFill: '#26a17b',
      downFill: '#e2544c',
      vwap: '#f0b429',
      bb: '#6b8afd',
      bbFill: 'rgba(107,138,253,0.07)',
      crosshair: 'rgba(255,255,255,0.35)',
      support: '#26a17b',
      resistance: '#e2544c',
      sr: 'rgba(200,210,230,0.45)',
      fib: 'rgba(240,180,41,0.5)',
      drawing: '#40c4ff',
      regression: '#b06bfd',
    },
  };

  const MA_COLORS = ['#f5f7fa', '#ffb454', '#4dd0e1', '#b06bfd', '#8bc34a'];

  class ScalpChart {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opt = Object.assign({}, DEFAULTS, options);
      this.candles = [];
      this.analysis = null;
      this.view = { end: 0, count: 140 };
      this.follow = true;
      this.hover = null;
      this.drawings = [];
      this.drawMode = false;
      this.pending = null;
      this.show = {
        ma: true, bb: true, vwap: true, trend: true, sr: true, fib: false, regression: false,
        volume: true, rsi: true, macd: true, stoch: false,
      };
      this.maConfig = [
        { period: 5, type: 'ema', on: true },
        { period: 20, type: 'sma', on: true },
        { period: 60, type: 'sma', on: true },
        { period: 120, type: 'sma', on: false },
      ];
      this.onHover = options.onHover || null;
      this.onDrawingsChange = options.onDrawingsChange || null;
      this._bind();
      this._resize();
    }

    /* ---------------------------------------------------------------- 데이터 */

    setData(candles, analysis) {
      const first = this.candles.length === 0;
      this.candles = candles || [];
      this.analysis = analysis || null;
      if (first || this.follow) this.view.end = this.candles.length;
      this.view.end = Math.min(this.view.end, this.candles.length);
      this.view.count = Math.min(this.view.count, Math.max(this.opt.minBars, this.candles.length));
      this.render();
    }

    setShow(patch) {
      Object.assign(this.show, patch);
      this.render();
    }

    setMaConfig(cfg) {
      this.maConfig = cfg;
      this.render();
    }

    setDrawings(list) {
      this.drawings = list || [];
      this.render();
    }

    setDrawMode(on) {
      this.drawMode = !!on;
      this.pending = null;
      this.canvas.style.cursor = on ? 'crosshair' : 'default';
      this.render();
    }

    resetView() {
      this.view.count = 140;
      this.view.end = this.candles.length;
      this.follow = true;
      this.render();
    }

    /* ------------------------------------------------------------- 레이아웃 */

    _resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.w = Math.max(320, rect.width);
      this.h = Math.max(240, rect.height);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _panes() {
      const p = this.opt.padding;
      const subs = [];
      if (this.show.volume) subs.push({ key: 'volume', weight: 0.16 });
      if (this.show.rsi) subs.push({ key: 'rsi', weight: 0.18 });
      if (this.show.macd) subs.push({ key: 'macd', weight: 0.18 });
      if (this.show.stoch) subs.push({ key: 'stoch', weight: 0.18 });

      const usable = this.h - p.top - p.bottom;
      const subTotal = subs.reduce((a, b) => a + b.weight, 0);
      const scale = subTotal > 0.62 ? 0.62 / subTotal : 1; // 메인 패널 최소 높이 확보
      let y = p.top;
      const panes = [];
      const mainH = usable * (1 - Math.min(0.62, subTotal * scale));
      panes.push({ key: 'main', top: y, height: mainH });
      y += mainH;
      for (const s of subs) {
        const hgt = usable * s.weight * scale;
        panes.push({ key: s.key, top: y, height: hgt });
        y += hgt;
      }
      return panes;
    }

    _visible() {
      const end = Math.min(this.candles.length, Math.max(1, this.view.end));
      const count = Math.min(this.view.count, end);
      return { start: Math.max(0, end - count), end };
    }

    _plot() {
      const p = this.opt.padding;
      return { x: p.left, width: Math.max(50, this.w - p.left - p.right) };
    }

    _xOf(i) {
      const { start, end } = this._visible();
      const { x, width } = this._plot();
      const n = Math.max(1, end - start);
      const bw = width / n;
      return x + (i - start) * bw + bw / 2;
    }

    _indexAt(px) {
      const { start, end } = this._visible();
      const { x, width } = this._plot();
      const n = Math.max(1, end - start);
      const bw = width / n;
      return Math.round(start + (px - x) / bw - 0.5);
    }

    /* ------------------------------------------------------------- 스케일링 */

    _mainRange() {
      const { start, end } = this._visible();
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = start; i < end; i++) {
        const c = this.candles[i];
        if (!c) continue;
        lo = Math.min(lo, c.l);
        hi = Math.max(hi, c.h);
      }
      const a = this.analysis;
      const push = (arr) => {
        if (!arr) return;
        for (let i = start; i < end; i++) {
          const v = arr[i];
          if (v == null || !isFinite(v)) continue;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      };
      if (a) {
        if (this.show.bb && a.bb) {
          push(a.bb.upper);
          push(a.bb.lower);
        }
        if (this.show.vwap) push(a.vwap);
        if (this.show.ma) this.maConfig.forEach((m, k) => m.on && push(a.ma[k]));
      }
      if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 };
      if (lo === hi) {
        lo -= 1;
        hi += 1;
      }
      const pad = (hi - lo) * 0.08;
      return { lo: lo - pad, hi: hi + pad };
    }

    _yMaker(pane, lo, hi) {
      const top = pane.top + 4;
      const height = Math.max(10, pane.height - 10);
      return (v) => top + (1 - (v - lo) / (hi - lo || 1)) * height;
    }

    /* ---------------------------------------------------------------- 렌더링 */

    render() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const C = this.opt.colors;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, this.w, this.h);
      if (!this.candles.length) {
        ctx.fillStyle = C.axis;
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('데이터를 불러오는 중…', this.w / 2, this.h / 2);
        return;
      }

      const panes = this._panes();
      this.panes = panes;
      const main = panes[0];
      const { lo, hi } = this._mainRange();
      const y = this._yMaker(main, lo, hi);
      this.mainY = y;
      this.mainRange = { lo, hi };

      this._drawGrid(main, lo, hi, y);
      if (this.show.fib) this._drawFib(y);
      if (this.show.sr) this._drawSR(y);
      if (this.show.bb) this._drawBollinger(y);
      this._drawCandles(main, y);
      if (this.show.ma) this._drawMAs(y);
      if (this.show.vwap) this._drawSeries(this.analysis && this.analysis.vwap, y, C.vwap, 1.4, [5, 3]);
      if (this.show.trend) this._drawTrendlines(y);
      if (this.show.regression) this._drawRegression(y);
      this._drawUserDrawings(y);
      this._drawLastPrice(main, y);

      for (let i = 1; i < panes.length; i++) this._drawSubPane(panes[i]);
      this._drawTimeAxis();
      this._drawCrosshair();
    }

    _drawGrid(pane, lo, hi, y) {
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { x, width } = this._plot();
      const steps = 6;
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= steps; i++) {
        const v = lo + ((hi - lo) * i) / steps;
        const py = Math.round(y(v)) + 0.5;
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x + width, py);
        ctx.stroke();
        ctx.fillStyle = C.axis;
        ctx.fillText(fmtPrice(v), x + width + 6, py);
      }
    }

    _drawCandles(pane, y) {
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { start, end } = this._visible();
      const { width } = this._plot();
      const bw = width / Math.max(1, end - start);
      const body = Math.max(1, Math.min(18, bw * 0.66));
      for (let i = start; i < end; i++) {
        const c = this.candles[i];
        if (!c) continue;
        const up = c.c >= c.o;
        const color = up ? C.up : C.down;
        const cx = this._xOf(i);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = Math.max(1, Math.min(2, bw * 0.12));
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, y(c.h));
        ctx.lineTo(Math.round(cx) + 0.5, y(c.l));
        ctx.stroke();
        const yo = y(c.o);
        const yc = y(c.c);
        const top = Math.min(yo, yc);
        const hgt = Math.max(1, Math.abs(yc - yo));
        if (body <= 2) {
          ctx.fillRect(Math.round(cx), top, 1, hgt);
        } else if (up) {
          ctx.fillRect(Math.round(cx - body / 2), top, Math.round(body), hgt);
        } else {
          ctx.fillRect(Math.round(cx - body / 2), top, Math.round(body), hgt);
        }
      }
    }

    _drawSeries(arr, y, color, lw = 1.2, dash = null) {
      if (!arr) return;
      const ctx = this.ctx;
      const { start, end } = this._visible();
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let pen = false;
      for (let i = start; i < end; i++) {
        const v = arr[i];
        if (v == null || !isFinite(v)) {
          pen = false;
          continue;
        }
        const px = this._xOf(i);
        const py = y(v);
        if (!pen) {
          ctx.moveTo(px, py);
          pen = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    _drawMAs(y) {
      const a = this.analysis;
      if (!a || !a.ma) return;
      this.maConfig.forEach((m, k) => {
        if (!m.on) return;
        this._drawSeries(a.ma[k], y, MA_COLORS[k % MA_COLORS.length], 1.3);
      });
    }

    _drawBollinger(y) {
      const a = this.analysis;
      if (!a || !a.bb) return;
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { start, end } = this._visible();
      // 밴드 내부 음영
      ctx.save();
      ctx.fillStyle = C.bbFill;
      ctx.beginPath();
      let started = false;
      for (let i = start; i < end; i++) {
        const v = a.bb.upper[i];
        if (v == null) continue;
        const px = this._xOf(i);
        if (!started) {
          ctx.moveTo(px, y(v));
          started = true;
        } else ctx.lineTo(px, y(v));
      }
      for (let i = end - 1; i >= start; i--) {
        const v = a.bb.lower[i];
        if (v == null) continue;
        ctx.lineTo(this._xOf(i), y(v));
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      this._drawSeries(a.bb.upper, y, C.bb, 1.1);
      this._drawSeries(a.bb.lower, y, C.bb, 1.1);
      this._drawSeries(a.bb.mid, y, 'rgba(107,138,253,0.75)', 1, [4, 3]);
    }

    _drawSR(y) {
      const a = this.analysis;
      if (!a || !a.srLevels) return;
      const ctx = this.ctx;
      const { x, width } = this._plot();
      const price = this.candles[this.candles.length - 1].c;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      for (const lvl of a.srLevels) {
        const py = y(lvl.price);
        if (py < 0 || py > this.h) continue;
        const isRes = lvl.price > price;
        ctx.strokeStyle = isRes ? 'rgba(226,84,76,0.45)' : 'rgba(38,161,123,0.45)';
        ctx.lineWidth = Math.min(2, 0.8 + lvl.touches * 0.25);
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x + width, py);
        ctx.stroke();
        if (width > 520) {
          ctx.fillStyle = isRes ? 'rgba(226,84,76,0.85)' : 'rgba(38,161,123,0.85)';
          ctx.textAlign = 'left';
          ctx.fillText(`${isRes ? '저항' : '지지'} ${fmtPrice(lvl.price)} (${lvl.touches})`, x + 4, py - 2);
        }
      }
      ctx.restore();
    }

    _drawFib(y) {
      const a = this.analysis;
      if (!a || !a.fib) return;
      const ctx = this.ctx;
      const { x, width } = this._plot();
      ctx.save();
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      ctx.setLineDash([2, 4]);
      for (const lv of a.fib.levels) {
        const py = y(lv.price);
        if (py < 0 || py > this.h) continue;
        ctx.strokeStyle = this.opt.colors.fib;
        ctx.lineWidth = lv.ratio === 0.618 || lv.ratio === 0.382 ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x + width, py);
        ctx.stroke();
        if (width > 520) {
          ctx.fillStyle = 'rgba(240,180,41,0.9)';
          ctx.textAlign = 'right';
          ctx.fillText(`${(lv.ratio * 100).toFixed(1)}%  ${fmtPrice(lv.price)}`, x + width - 4, py - 2);
        }
      }
      ctx.restore();
    }

    _drawLine(line, y, color, dash) {
      if (!line) return;
      const ctx = this.ctx;
      const { start, end } = this._visible();
      const x1 = Math.max(start, line.from ? line.from.i : start);
      const x2 = end - 1;
      if (x2 <= x1) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(this._xOf(x1), y(line.slope * x1 + line.intercept));
      ctx.lineTo(this._xOf(x2), y(line.slope * x2 + line.intercept));
      ctx.stroke();
      ctx.restore();
    }

    _drawTrendlines(y) {
      const a = this.analysis;
      if (!a || !a.trend) return;
      this._drawLine(a.trend.resistance, y, 'rgba(226,84,76,0.9)', [7, 4]);
      this._drawLine(a.trend.support, y, 'rgba(38,161,123,0.9)', [7, 4]);
    }

    _drawRegression(y) {
      const a = this.analysis;
      if (!a || !a.regression) return;
      this._drawLine(a.regression, y, this.opt.colors.regression, [2, 3]);
    }

    _drawUserDrawings(y) {
      const ctx = this.ctx;
      const list = this.drawings.slice();
      if (this.pending && this.pendingCursor) {
        list.push({ x1: this.pending.i, y1: this.pending.price, x2: this.pendingCursor.i, y2: this.pendingCursor.price, temp: true });
      }
      ctx.save();
      for (const d of list) {
        ctx.strokeStyle = this.opt.colors.drawing;
        ctx.lineWidth = d.temp ? 1 : 1.6;
        if (d.temp) ctx.setLineDash([4, 4]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(this._xOf(d.x1), y(d.y1));
        ctx.lineTo(this._xOf(d.x2), y(d.y2));
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawLastPrice(pane, y) {
      const ctx = this.ctx;
      const last = this.candles[this.candles.length - 1];
      if (!last) return;
      const { x, width } = this._plot();
      const py = y(last.c);
      if (py < pane.top || py > pane.top + pane.height) return;
      const up = last.c >= last.o;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = up ? this.opt.colors.up : this.opt.colors.down;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + width, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = up ? this.opt.colors.up : this.opt.colors.down;
      ctx.fillRect(x + width + 2, py - 8, this.opt.padding.right - 6, 16);
      ctx.fillStyle = '#08090c';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtPrice(last.c), x + width + 6, py);
      ctx.restore();
    }

    /* -------------------------------------------------------------- 서브패널 */

    _drawSubPane(pane) {
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { x, width } = this._plot();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, Math.round(pane.top) + 0.5);
      ctx.lineTo(x + width, Math.round(pane.top) + 0.5);
      ctx.stroke();
      ctx.restore();

      if (pane.key === 'volume') this._drawVolume(pane);
      if (pane.key === 'rsi') this._drawRSI(pane);
      if (pane.key === 'macd') this._drawMACD(pane);
      if (pane.key === 'stoch') this._drawStoch(pane);

      ctx.fillStyle = 'rgba(199,206,222,0.65)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(PANE_LABEL[pane.key] || pane.key, x + 4, pane.top + 3);
    }

    _drawVolume(pane) {
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { start, end } = this._visible();
      let max = 0;
      for (let i = start; i < end; i++) max = Math.max(max, this.candles[i].v || 0);
      if (!max) return;
      const y = this._yMaker(pane, 0, max * 1.1);
      const bw = this._plot().width / Math.max(1, end - start);
      const body = Math.max(1, bw * 0.66);
      for (let i = start; i < end; i++) {
        const c = this.candles[i];
        const up = c.c >= c.o;
        ctx.fillStyle = up ? 'rgba(38,161,123,0.55)' : 'rgba(226,84,76,0.55)';
        const py = y(c.v || 0);
        ctx.fillRect(this._xOf(i) - body / 2, py, body, pane.top + pane.height - py - 2);
      }
      const va = this.analysis && this.analysis.volMa;
      if (va) this._drawSeries(va, y, 'rgba(240,180,41,0.9)', 1.1);
    }

    _drawRSI(pane) {
      const a = this.analysis;
      if (!a || !a.rsi) return;
      const ctx = this.ctx;
      const { x, width } = this._plot();
      const y = this._yMaker(pane, 0, 100);
      ctx.save();
      ctx.setLineDash([3, 3]);
      for (const lvl of [30, 50, 70]) {
        ctx.strokeStyle = lvl === 50 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.moveTo(x, y(lvl));
        ctx.lineTo(x + width, y(lvl));
        ctx.stroke();
      }
      ctx.restore();
      this._drawSeries(a.rsi, y, '#c586ff', 1.3);
      const last = lastVal(a.rsi);
      if (last != null) this._paneValue(pane, `RSI ${last.toFixed(1)}`, last >= 70 ? '#e2544c' : last <= 30 ? '#26a17b' : '#c586ff');
    }

    _drawMACD(pane) {
      const a = this.analysis;
      if (!a || !a.macd) return;
      const ctx = this.ctx;
      const { start, end } = this._visible();
      let max = 0;
      for (let i = start; i < end; i++) {
        for (const arr of [a.macd.line, a.macd.signal, a.macd.hist]) {
          const v = arr[i];
          if (v != null && isFinite(v)) max = Math.max(max, Math.abs(v));
        }
      }
      if (!max) return;
      const y = this._yMaker(pane, -max * 1.15, max * 1.15);
      const bw = this._plot().width / Math.max(1, end - start);
      const zero = y(0);
      for (let i = start; i < end; i++) {
        const v = a.macd.hist[i];
        if (v == null) continue;
        const prev = a.macd.hist[i - 1];
        const rising = prev == null || v >= prev;
        ctx.fillStyle = v >= 0
          ? (rising ? 'rgba(38,161,123,0.85)' : 'rgba(38,161,123,0.4)')
          : (rising ? 'rgba(226,84,76,0.4)' : 'rgba(226,84,76,0.85)');
        const py = y(v);
        ctx.fillRect(this._xOf(i) - bw * 0.3, Math.min(py, zero), Math.max(1, bw * 0.6), Math.abs(py - zero));
      }
      this._drawSeries(a.macd.line, y, '#4dd0e1', 1.2);
      this._drawSeries(a.macd.signal, y, '#ffb454', 1.2);
      const l = lastVal(a.macd.line);
      const s = lastVal(a.macd.signal);
      if (l != null && s != null) this._paneValue(pane, `MACD ${l.toFixed(3)} / SIG ${s.toFixed(3)}`, l >= s ? '#26a17b' : '#e2544c');
    }

    _drawStoch(pane) {
      const a = this.analysis;
      if (!a || !a.stoch) return;
      const ctx = this.ctx;
      const { x, width } = this._plot();
      const y = this._yMaker(pane, 0, 100);
      ctx.save();
      ctx.setLineDash([3, 3]);
      for (const lvl of [20, 80]) {
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.moveTo(x, y(lvl));
        ctx.lineTo(x + width, y(lvl));
        ctx.stroke();
      }
      ctx.restore();
      this._drawSeries(a.stoch.k, y, '#4dd0e1', 1.2);
      this._drawSeries(a.stoch.d, y, '#ffb454', 1.2);
      const k = lastVal(a.stoch.k);
      if (k != null) this._paneValue(pane, `%K ${k.toFixed(1)}`, k >= 80 ? '#e2544c' : k <= 20 ? '#26a17b' : '#4dd0e1');
    }

    _paneValue(pane, text, color) {
      const ctx = this.ctx;
      const { x, width } = this._plot();
      ctx.fillStyle = color;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(text, x + width - 4, pane.top + 3);
    }

    /* -------------------------------------------------------------- 축/십자선 */

    _drawTimeAxis() {
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { start, end } = this._visible();
      const { x, width } = this._plot();
      const n = end - start;
      const step = Math.max(1, Math.round(n / Math.max(3, Math.floor(width / 90))));
      ctx.fillStyle = C.axis;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const yy = this.h - this.opt.padding.bottom + 5;
      for (let i = start; i < end; i += step) {
        const c = this.candles[i];
        if (!c) continue;
        const px = this._xOf(i);
        if (px < x || px > x + width) continue;
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, this.opt.padding.top);
        ctx.lineTo(Math.round(px) + 0.5, this.h - this.opt.padding.bottom);
        ctx.stroke();
        ctx.fillStyle = C.axis;
        ctx.fillText(this.fmtTime(c.t), px, yy);
      }
    }

    fmtTime(ts) {
      const intraday = this.intraday !== false;
      try {
        return new Intl.DateTimeFormat('ko-KR', {
          timeZone: this.opt.timeZone,
          ...(intraday
            ? { hour: '2-digit', minute: '2-digit', hour12: false }
            : { month: '2-digit', day: '2-digit' }),
        }).format(new Date(ts));
      } catch (_) {
        const d = new Date(ts);
        return intraday
          ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : `${d.getMonth() + 1}/${d.getDate()}`;
      }
    }

    fmtDateTime(ts) {
      const intraday = this.intraday !== false;
      try {
        return new Intl.DateTimeFormat('ko-KR', {
          timeZone: this.opt.timeZone,
          year: intraday ? undefined : 'numeric',
          month: '2-digit', day: '2-digit',
          ...(intraday ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
        }).format(new Date(ts));
      } catch (_) {
        return new Date(ts).toLocaleString();
      }
    }

    _drawCrosshair() {
      if (!this.hover) return;
      const ctx = this.ctx;
      const C = this.opt.colors;
      const { x, width } = this._plot();
      const i = this.hover.index;
      const c = this.candles[i];
      if (!c) return;
      const px = this._xOf(i);
      ctx.save();
      ctx.strokeStyle = C.crosshair;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, this.opt.padding.top);
      ctx.lineTo(Math.round(px) + 0.5, this.h - this.opt.padding.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, Math.round(this.hover.y) + 0.5);
      ctx.lineTo(x + width, Math.round(this.hover.y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      // 우측 가격 라벨
      if (this.mainY && this.hover.y > this.opt.padding.top && this.hover.y < this.panes[0].top + this.panes[0].height) {
        const price = this._priceAtY(this.hover.y);
        ctx.fillStyle = '#2a3142';
        ctx.fillRect(x + width + 2, this.hover.y - 8, this.opt.padding.right - 6, 16);
        ctx.fillStyle = '#e8ecf5';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmtPrice(price), x + width + 6, this.hover.y);
      }
      // 하단 시간 라벨
      const label = this.fmtDateTime(c.t);
      ctx.font = '10px ui-monospace, monospace';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#2a3142';
      ctx.fillRect(px - tw / 2, this.h - this.opt.padding.bottom + 2, tw, 15);
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, px, this.h - this.opt.padding.bottom + 5);
      ctx.restore();
    }

    _priceAtY(py) {
      const pane = this.panes[0];
      const top = pane.top + 4;
      const height = Math.max(10, pane.height - 10);
      const { lo, hi } = this.mainRange;
      return lo + (1 - (py - top) / height) * (hi - lo);
    }

    /* ------------------------------------------------------------- 이벤트 */

    _bind() {
      const cv = this.canvas;
      this._onResize = () => {
        this._resize();
        this.render();
      };
      window.addEventListener('resize', this._onResize);

      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const before = this._indexAt(e.offsetX);
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const next = Math.round(this.view.count * factor);
        this.view.count = clamp(next, this.opt.minBars, Math.min(this.opt.maxBars, this.candles.length || this.opt.maxBars));
        const after = this._indexAt(e.offsetX);
        this.view.end = clamp(this.view.end + (before - after), this.view.count, this.candles.length);
        this.follow = this.view.end >= this.candles.length;
        this.render();
      }, { passive: false });

      let dragging = false;
      let dragX = 0;
      let dragEnd = 0;

      cv.addEventListener('mousedown', (e) => {
        if (this.drawMode) {
          const pt = this._pointAt(e.offsetX, e.offsetY);
          if (!this.pending) {
            this.pending = pt;
          } else {
            this.drawings.push({ x1: this.pending.i, y1: this.pending.price, x2: pt.i, y2: pt.price });
            this.pending = null;
            if (this.onDrawingsChange) this.onDrawingsChange(this.drawings);
          }
          this.render();
          return;
        }
        dragging = true;
        dragX = e.offsetX;
        dragEnd = this.view.end;
        cv.style.cursor = 'grabbing';
      });

      window.addEventListener('mouseup', () => {
        dragging = false;
        if (!this.drawMode) cv.style.cursor = 'default';
      });

      cv.addEventListener('mousemove', (e) => {
        const { start, end } = this._visible();
        if (dragging) {
          const bw = this._plot().width / Math.max(1, end - start);
          const shift = Math.round((dragX - e.offsetX) / bw);
          this.view.end = clamp(dragEnd + shift, this.view.count, this.candles.length);
          this.follow = this.view.end >= this.candles.length;
        }
        const idx = clamp(this._indexAt(e.offsetX), 0, this.candles.length - 1);
        this.hover = { index: idx, y: e.offsetY, x: e.offsetX };
        if (this.drawMode && this.pending) this.pendingCursor = this._pointAt(e.offsetX, e.offsetY);
        this.render();
        if (this.onHover) this.onHover(idx, this.candles[idx]);
      });

      cv.addEventListener('mouseleave', () => {
        this.hover = null;
        this.render();
        if (this.onHover) this.onHover(this.candles.length - 1, this.candles[this.candles.length - 1]);
      });

      cv.addEventListener('dblclick', () => this.resetView());

      // 모바일: 한 손가락 이동, 두 손가락 확대
      let touchStartX = 0;
      let touchEnd = 0;
      let pinch = 0;
      let pinchCount = 0;
      cv.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchEnd = this.view.end;
        } else if (e.touches.length === 2) {
          pinch = touchDist(e);
          pinchCount = this.view.count;
        }
      }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        const { start, end } = this._visible();
        if (e.touches.length === 1) {
          const bw = this._plot().width / Math.max(1, end - start);
          const shift = Math.round((touchStartX - e.touches[0].clientX) / bw);
          this.view.end = clamp(touchEnd + shift, this.view.count, this.candles.length);
          this.follow = this.view.end >= this.candles.length;
          this.render();
        } else if (e.touches.length === 2 && pinch) {
          const d = touchDist(e);
          this.view.count = clamp(Math.round((pinchCount * pinch) / (d || 1)), this.opt.minBars, Math.min(this.opt.maxBars, this.candles.length));
          this.render();
        }
      }, { passive: true });
    }

    _pointAt(px, py) {
      return { i: clamp(this._indexAt(px), 0, Math.max(0, this.candles.length - 1)), price: this._priceAtY(py) };
    }

    destroy() {
      window.removeEventListener('resize', this._onResize);
    }
  }

  const PANE_LABEL = { volume: '거래량', rsi: 'RSI(14)', macd: 'MACD(12,26,9)', stoch: '스토캐스틱(14,3,3)' };

  function touchDist(e) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function lastVal(arr) {
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && isFinite(arr[i])) return arr[i];
    return null;
  }
  function fmtPrice(v) {
    if (v == null || !isFinite(v)) return '-';
    const abs = Math.abs(v);
    return abs >= 1000 ? v.toFixed(1) : abs >= 1 ? v.toFixed(2) : v.toFixed(4);
  }

  root.ScalpChart = ScalpChart;
  root.MA_COLORS = MA_COLORS;
  root.fmtPrice = fmtPrice;
})(window);
