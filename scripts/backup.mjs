#!/usr/bin/env node
/**
 * 데이터 백업.
 *
 * 회원 기록은 파일 하나(db.json)다. 디스크가 상하거나 실수로 지우면 그걸로 끝이다.
 * 사용자가 4주간 쌓은 기록을 잃는 건 서비스가 문을 닫는 것과 같으므로,
 * 최소한 자동 복사본은 있어야 한다.
 *
 *   npm run backup                 기본 위치에 백업
 *   BACKUP_DIR=/data/backups npm run backup
 *   BACKUP_KEEP=30 npm run backup  보관 개수 (기본 14)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DB = process.env.SKINLAB_DB || path.join(ROOT, 'data', 'db.json');
const DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;

if (!fs.existsSync(DB)) {
  console.error(`백업할 파일이 없습니다: ${DB}`);
  console.error('아직 사용자가 없거나, SKINLAB_DB 경로가 다를 수 있습니다.');
  process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(DIR, `db-${stamp}.json.gz`);

const raw = fs.readFileSync(DB);
// 저장 전에 읽을 수 있는 JSON 인지 확인한다 — 깨진 파일을 백업해두면 백업이 아니다
try {
  const parsed = JSON.parse(raw.toString('utf8'));
  const users = Object.keys(parsed.users || {}).length;
  const analyses = Object.keys(parsed.analyses || {}).length;
  fs.writeFileSync(out, zlib.gzipSync(raw));
  console.log(`백업 완료: ${out}`);
  console.log(`  사용자 ${users}명 · 진단 ${analyses}건 · ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
} catch (err) {
  console.error(`원본이 손상된 것 같습니다 (${err.message}). 백업하지 않았습니다.`);
  console.error('가장 최근 정상 백업으로 복구하는 편이 안전합니다.');
  process.exit(1);
}

// 오래된 백업 정리
const files = fs.readdirSync(DIR).filter((f) => /^db-.*\.json\.gz$/.test(f)).sort();
const drop = files.slice(0, Math.max(0, files.length - KEEP));
for (const f of drop) fs.unlinkSync(path.join(DIR, f));
if (drop.length) console.log(`  오래된 백업 ${drop.length}개 정리 (최근 ${KEEP}개 보관)`);

console.log(`\n복구하려면:  gunzip -c ${out} > ${DB}   (서버를 멈춘 뒤 실행)`);
