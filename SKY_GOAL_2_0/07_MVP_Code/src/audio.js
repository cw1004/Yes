/*
 * SKY GOAL 2.0 — 사운드 엔진
 * WebAudio 로 전부 합성한다. 외부 음원 파일이 없으므로 단일 HTML 배포가 유지된다.
 * AudioContext 가 없거나 차단된 환경에서도 게임이 멈추지 않도록 모든 호출이 안전하다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SkyGoalAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // D 마이너 펜타토닉 — 신나면서 인도풍 선율과도 잘 맞는 음계
  var SCALE = [146.83, 174.61, 196.00, 220.00, 261.63, 293.66, 349.23, 392.00];
  var BASS = [73.42, 73.42, 98.00, 87.31];         // 마디별 베이스 루트
  var TEMPO = 132;                                  // BPM
  var STEPS_PER_BAR = 16;                           // 16분음표

  function create(options) {
    options = options || {};
    var Ctor = options.AudioContextCtor;
    if (Ctor === undefined && typeof window !== 'undefined') {
      Ctor = window.AudioContext || window.webkitAudioContext;
    }

    var ctx = null;
    var master = null, musicBus = null, sfxBus = null;
    var noise = null;
    var muted = !!options.muted;
    var timer = null;
    var step = 0;
    var nextTime = 0;
    var intensity = 0;
    var failed = false;

    function ensure() {
      if (failed) return null;
      if (ctx) return ctx;
      if (!Ctor) { failed = true; return null; }
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.9;
        master.connect(ctx.destination);
        musicBus = ctx.createGain();
        musicBus.gain.value = 0.42;
        musicBus.connect(master);
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.85;
        sfxBus.connect(master);

        var len = Math.floor(ctx.sampleRate * 0.5);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = noise.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch (e) {
        failed = true;
        ctx = null;
      }
      return ctx;
    }

    // 브라우저 정책상 사용자 입력이 있어야 소리가 난다.
    function unlock() {
      var c = ensure();
      if (!c) return false;
      if (c.state === 'suspended' && c.resume) { try { c.resume(); } catch (e) { /* 무시 */ } }
      return c.state !== 'suspended';
    }

    function now() {
      var c = ensure();
      return c ? c.currentTime : 0;
    }

    /* ------------------------------------------------------------ 음색 */

    function tone(opts) {
      var c = ensure();
      if (!c) return;
      var t = opts.at || c.currentTime;
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(opts.from, t);
      if (opts.to && opts.to !== opts.from) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + (opts.attack || 0.005));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
      var out = gain;
      if (opts.filter) {
        var f = c.createBiquadFilter();
        f.type = opts.filter;
        f.frequency.value = opts.cutoff || 900;
        gain.connect(f);
        out = f;
      }
      osc.connect(gain);
      out.connect(opts.bus || sfxBus);
      osc.start(t);
      osc.stop(t + opts.dur + 0.02);
    }

    function hit(opts) {
      var c = ensure();
      if (!c || !noise) return;
      var t = opts.at || c.currentTime;
      var src = c.createBufferSource();
      src.buffer = noise;
      var f = c.createBiquadFilter();
      f.type = opts.filter || 'highpass';
      f.frequency.setValueAtTime(opts.cutoff || 6000, t);
      if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.dur);
      var gain = c.createGain();
      gain.gain.setValueAtTime(opts.gain, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
      src.connect(f); f.connect(gain); gain.connect(opts.bus || sfxBus);
      src.start(t);
      src.stop(t + opts.dur + 0.02);
    }

    /* -------------------------------------------------------- 리듬 파트 */

    function kick(t) {
      tone({ at: t, type: 'sine', from: 165, to: 45, dur: 0.20, gain: 0.95, bus: musicBus });
      hit({ at: t, filter: 'lowpass', cutoff: 220, dur: 0.05, gain: 0.35, bus: musicBus });
    }
    function snare(t) {
      hit({ at: t, filter: 'bandpass', cutoff: 1900, dur: 0.16, gain: 0.34, bus: musicBus });
      tone({ at: t, type: 'triangle', from: 220, to: 160, dur: 0.10, gain: 0.18, bus: musicBus });
    }
    function hat(t, accent) {
      hit({ at: t, filter: 'highpass', cutoff: 8200, dur: accent ? 0.05 : 0.03,
            gain: accent ? 0.16 : 0.09, bus: musicBus });
    }
    function tabla(t, high) {
      tone({ at: t, type: 'sine', from: high ? 420 : 300, to: high ? 240 : 150,
             dur: 0.09, gain: 0.30, bus: musicBus });
    }
    function bass(t, freq) {
      tone({ at: t, type: 'sawtooth', from: freq, to: freq, dur: 0.20, gain: 0.42,
             filter: 'lowpass', cutoff: 420, bus: musicBus });
    }
    function lead(t, freq, dur) {
      tone({ at: t, type: 'triangle', from: freq, to: freq, dur: dur || 0.16, gain: 0.24, bus: musicBus });
    }

    // intensity 0~3 에 따라 파트가 쌓인다 (스테이지가 올라갈수록 신나게)
    function scheduleStep(index, t) {
      var inBar = index % STEPS_PER_BAR;
      var bar = Math.floor(index / STEPS_PER_BAR) % 4;

      if (inBar % 4 === 0) kick(t);
      if (intensity >= 1 && (inBar === 6 || inBar === 14)) kick(t);
      if (inBar === 4 || inBar === 12) snare(t);
      if (inBar % 2 === 0) hat(t, inBar % 8 === 0);
      if (intensity >= 1 && (inBar === 3 || inBar === 7 || inBar === 11 || inBar === 15)) {
        tabla(t, inBar === 7 || inBar === 15);
      }
      if (inBar % 8 === 0) bass(t, BASS[bar]);
      if (intensity >= 2 && inBar % 4 === 2) bass(t, BASS[bar] * 1.5);
      if (intensity >= 2 && inBar % 2 === 1) {
        lead(t, SCALE[(index + bar) % SCALE.length], 0.12);
      }
      if (intensity >= 3 && inBar % 4 === 0) {
        lead(t, SCALE[(index * 3 + 2) % SCALE.length] * 2, 0.10);
      }
    }

    function pump() {
      var c = ensure();
      if (!c) return;
      var spb = 60 / TEMPO / 4;                       // 16분음표 길이(초)
      while (nextTime < c.currentTime + 0.12) {       // 0.12초 앞을 미리 예약
        scheduleStep(step, nextTime);
        step += 1;
        nextTime += spb;
      }
    }

    function startMusic(level) {
      intensity = Math.max(0, Math.min(3, level || 0));
      var c = ensure();
      if (!c || timer) return;
      unlock();
      step = 0;
      nextTime = c.currentTime + 0.06;
      pump();
      timer = setInterval(pump, 25);
    }

    function stopMusic() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    /* --------------------------------------------------------- 효과음 */

    var api = {
      unlock: unlock,
      available: function () { return !!ensure(); },
      isMuted: function () { return muted; },
      setMuted: function (v) {
        muted = !!v;
        if (master) {
          try {
            master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.02);
          } catch (e) { master.gain.value = muted ? 0 : 0.9; }
        }
        return muted;
      },
      toggleMute: function () { return api.setMuted(!muted); },

      // 킥오프 심판 휘슬 — 두 음이 살짝 어긋나며 떨리는 소리
      whistle: function () {
        var t = now();
        [2450, 2620].forEach(function (f, i) {
          tone({ at: t + i * 0.004, type: 'square', from: f, to: f * 0.97,
                 dur: 0.42, gain: 0.13, attack: 0.02 });
        });
        hit({ at: t, filter: 'bandpass', cutoff: 2600, dur: 0.42, gain: 0.06 });
      },

      // 공을 차는 임팩트 — 저역 텅 + 가죽 마찰음
      kick: function () {
        var t = now();
        tone({ at: t, type: 'sine', from: 240, to: 55, dur: 0.26, gain: 0.95 });
        tone({ at: t, type: 'triangle', from: 620, to: 180, dur: 0.12, gain: 0.35 });
        hit({ at: t, filter: 'bandpass', cutoff: 1800, sweepTo: 400, dur: 0.18, gain: 0.45 });
        hit({ at: t + 0.02, filter: 'highpass', cutoff: 5200, dur: 0.06, gain: 0.18 });
      },

      // 헤딩 성공 — 이마에 맞는 둔탁한 타격 + 짧은 함성
      header: function () {
        var t = now();
        tone({ at: t, type: 'sine', from: 300, to: 90, dur: 0.16, gain: 0.75 });
        hit({ at: t, filter: 'lowpass', cutoff: 900, dur: 0.10, gain: 0.35 });
        [0, 3, 5].forEach(function (i, k) {
          tone({ at: t + 0.05 + k * 0.05, type: 'triangle', from: SCALE[i] * 3, to: SCALE[i] * 3,
                 dur: 0.18, gain: 0.20 });
        });
        hit({ at: t + 0.04, filter: 'bandpass', cutoff: 1100, sweepTo: 2400, dur: 0.7, gain: 0.16 });
      },

      tap: function () {
        tone({ type: 'triangle', from: 680, to: 340, dur: 0.09, gain: 0.30 });
        hit({ filter: 'highpass', cutoff: 3200, dur: 0.04, gain: 0.10 });
      },
      pass: function (combo) {
        var n = Math.min(6, Math.max(0, combo || 0));
        tone({ type: 'square', from: 900 + n * 60, to: 1350 + n * 90, dur: 0.07, gain: 0.16 });
      },
      perfect: function () {
        var t = now();
        [0, 2, 4].forEach(function (i, k) {
          tone({ at: t + k * 0.055, type: 'triangle', from: SCALE[i] * 4, to: SCALE[i] * 4,
                 dur: 0.16, gain: 0.24 });
        });
      },
      stage: function () {
        var t = now();
        tone({ at: t, type: 'sawtooth', from: 220, to: 880, dur: 0.45, gain: 0.20,
               filter: 'lowpass', cutoff: 1800 });
        hit({ at: t, filter: 'bandpass', cutoff: 900, sweepTo: 2600, dur: 0.9, gain: 0.22 }); // 관중 함성
      },
      die: function () {
        var t = now();
        tone({ at: t, type: 'sawtooth', from: 320, to: 60, dur: 0.55, gain: 0.42,
               filter: 'lowpass', cutoff: 700 });
        hit({ at: t, filter: 'lowpass', cutoff: 1200, sweepTo: 200, dur: 0.4, gain: 0.25 });
      },
      levelUp: function () {
        var t = now();
        [0, 2, 4, 7].forEach(function (i, k) {
          tone({ at: t + k * 0.08, type: 'triangle', from: SCALE[i] * 2, to: SCALE[i] * 2,
                 dur: 0.22, gain: 0.26 });
        });
      },

      startMusic: startMusic,
      stopMusic: stopMusic,
      isPlaying: function () { return !!timer; },
      setIntensity: function (level) { intensity = Math.max(0, Math.min(3, level || 0)); },
      getIntensity: function () { return intensity; }
    };

    // 어떤 호출도 게임 루프를 죽이지 않도록 전부 try/catch 로 감싼다.
    Object.keys(api).forEach(function (k) {
      var fn = api[k];
      api[k] = function () {
        try { return fn.apply(null, arguments); } catch (e) { return undefined; }
      };
    });
    return api;
  }

  return { create: create, SCALE: SCALE, TEMPO: TEMPO };
});
