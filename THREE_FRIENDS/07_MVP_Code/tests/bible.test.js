'use strict';
/*
 * 캐릭터 바이블 ↔ 게임 코드 정합성.
 *
 * 바이블에 적힌 색과 게임에 칠해진 색이 다른 것은 IP 사업에서 흔한 사고다.
 * 라이선시는 바이블을 보고 굿즈를 만들고, 사용자는 게임을 본다.
 * 둘이 다르면 "같은 캐릭터"로 보이지 않는다. 그걸 사람 눈으로 지키지 않고 기계가 막는다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../src/engine.js');

const BIBLE_PATH = path.join(__dirname, '..', '..', '..', 'IP_BIBLE', 'characters.json');
const bible = JSON.parse(fs.readFileSync(BIBLE_PATH, 'utf8'));

test('바이블과 게임 코드의 캐릭터 목록이 같다', () => {
  const a = bible.characters.map((c) => c.id).sort();
  const b = E.CHARACTERS.map((c) => c.id).sort();
  assert.deepStrictEqual(a, b);
});

test('바이블의 색상값이 게임에 칠해진 색과 정확히 같다', () => {
  bible.characters.forEach((bc) => {
    const gc = E.characterById(bc.id);
    assert.deepStrictEqual(gc.color, bc.color,
      bc.name_ko + ' 의 색이 바이블과 다르다');
  });
});

test('볼터치와 외곽선은 세 명이 공유한다 (한 가족으로 보이게 하는 최소 장치)', () => {
  const cheek = bible.shared_palette.cheek;
  E.CHARACTERS.forEach((c) => {
    assert.strictEqual(c.color.cheek, cheek, c.name + ' 의 볼 색이 다르다');
  });
});

test('포인트 색은 셋이 모두 다르다 (3인조를 색으로 구분한다)', () => {
  const accents = E.CHARACTERS.map((c) => c.color.accent);
  assert.strictEqual(new Set(accents).size, 3, accents.join(', '));
});

test('몸 색은 흑백으로 줄여도 셋이 구분된다', () => {
  // 실루엣만으로 안 되면 색 명도라도 갈려 있어야 한다
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const vals = E.CHARACTERS.map((c) => lum(c.color.body)).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] - vals[i - 1] > 0.12,
      '몸 색 명도가 너무 가깝다: ' + vals.map((v) => v.toFixed(2)).join(' / '));
  }
});

test('바이블과 게임의 행동·전담 장애물이 일치한다', () => {
  bible.characters.forEach((bc) => {
    const gc = E.characterById(bc.id);
    assert.strictEqual(gc.action, bc.action, bc.name_ko + ' 의 행동이 다르다');
    assert.strictEqual(gc.action_ko !== undefined ? gc.action_ko : gc.actionKo, bc.action_ko);
    assert.strictEqual(E.obstacleById(gc.counters).name, bc.counters,
      bc.name_ko + ' 의 전담 장애물이 다르다');
  });
});

test('바이블에 실루엣 핵심과 어원이 빠짐없이 적혀 있다', () => {
  bible.characters.forEach((c) => {
    assert.ok(c.silhouette_key && c.silhouette_key.length > 5, c.id + ' 실루엣 규칙이 없다');
    assert.ok(c.etymology && c.etymology.length > 5, c.id + ' 이름 어원이 없다');
    assert.ok(c.species && c.role, c.id + ' 종/역할이 없다');
  });
});

test('IP 한 줄 정의와 핵심 주제가 있다 (모든 판단의 기준)', () => {
  assert.ok(bible.ip.logline && bible.ip.logline.length > 10);
  assert.ok(bible.ip.core_theme && bible.ip.core_theme.length > 5);
});
