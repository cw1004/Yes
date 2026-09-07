'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/audio.js');

// WebAudio 스텁 — 실제 소리는 내지 않고 호출만 기록한다.
function fakeContext() {
  const log = { osc: 0, buffers: 0, gains: 0, filters: 0, started: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; }
  });
  const node = () => ({ connect() {}, disconnect() {} });
  function Ctx() {
    this.currentTime = 1;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = node();
    this.__log = log;
  }
  Ctx.prototype.createGain = function () { log.gains++; return Object.assign(node(), { gain: param() }); };
  Ctx.prototype.createOscillator = function () {
    log.osc++;
    return Object.assign(node(), {
      type: 'sine', frequency: param(),
      start() { log.started++; }, stop() {}
    });
  };
  Ctx.prototype.createBiquadFilter = function () {
    log.filters++;
    return Object.assign(node(), { type: 'lowpass', frequency: param(), Q: param() });
  };
  Ctx.prototype.createBuffer = function (ch, len) {
    log.buffers++;
    return { getChannelData: () => new Float32Array(len) };
  };
  Ctx.prototype.createBufferSource = function () {
    return Object.assign(node(), { buffer: null, start() { log.started++; }, stop() {} });
  };
  Ctx.prototype.resume = function () { this.state = 'running'; };
  return { Ctx, log };
}

test('효과음은 오실레이터를 실제로 예약한다', () => {
  const { Ctx, log } = fakeContext();
  const a = A.create({ AudioContextCtor: Ctx });
  assert.strictEqual(a.available(), true);
  a.tap(); a.pass(3); a.perfect(); a.stage(); a.die(); a.levelUp();
  assert.ok(log.osc > 5, '오실레이터 생성 수: ' + log.osc);
  assert.ok(log.started > 5);
});

test('음악은 시작·정지되고 강도가 0~3 으로 제한된다', () => {
  const { Ctx, log } = fakeContext();
  const a = A.create({ AudioContextCtor: Ctx });
  a.startMusic(2);
  assert.strictEqual(a.isPlaying(), true);
  assert.strictEqual(a.getIntensity(), 2);
  assert.ok(log.osc > 0, '첫 예약이 즉시 일어난다');
  a.setIntensity(99);
  assert.strictEqual(a.getIntensity(), 3);
  a.setIntensity(-5);
  assert.strictEqual(a.getIntensity(), 0);
  a.stopMusic();
  assert.strictEqual(a.isPlaying(), false);
  a.stopMusic();                       // 두 번 호출해도 안전
});

test('음소거 토글', () => {
  const { Ctx } = fakeContext();
  const a = A.create({ AudioContextCtor: Ctx });
  assert.strictEqual(a.isMuted(), false);
  assert.strictEqual(a.toggleMute(), true);
  assert.strictEqual(a.isMuted(), true);
  a.setMuted(false);
  assert.strictEqual(a.isMuted(), false);

  const muted = A.create({ AudioContextCtor: Ctx, muted: true });
  assert.strictEqual(muted.isMuted(), true);
});

test('AudioContext 가 없으면 모든 호출이 조용히 무시된다', () => {
  const a = A.create({ AudioContextCtor: null });
  assert.strictEqual(a.available(), false);
  assert.strictEqual(a.unlock(), false);
  a.tap(); a.pass(1); a.perfect(); a.die(); a.stage(); a.levelUp();
  a.startMusic(3);
  assert.strictEqual(a.isPlaying(), false, '컨텍스트가 없으면 타이머도 돌지 않는다');
  a.stopMusic();
});

test('AudioContext 생성이 실패해도 게임은 계속된다', () => {
  function Broken() { throw new Error('blocked'); }
  const a = A.create({ AudioContextCtor: Broken });
  assert.strictEqual(a.available(), false);
  a.tap();
  a.startMusic(1);
  assert.strictEqual(a.isPlaying(), false);
});
