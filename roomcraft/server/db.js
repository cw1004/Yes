/**
 * SQLite 스키마 + 마이그레이션.
 *
 * 파일 DB 하나로 시작해서 인프라 없이 돌아가게 했습니다. Postgres 로 옮길 때는
 * 이 파일과 각 라우터의 쿼리만 바꾸면 되도록, SQL 을 이 계층 밖으로 새지 않게 유지합니다.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'data/roomcraft.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    plan_id       TEXT NOT NULL DEFAULT 'free',
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  -- 크레딧은 잔액 컬럼이 아니라 원장(ledger)으로 관리합니다.
  -- 잔액 = SUM(delta). 이중 지급/차감을 감사할 수 있고, 경쟁 조건에서 값이 덮이지 않습니다.
  CREATE TABLE credit_ledger (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta      INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    ref        TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_ledger_user ON credit_ledger(user_id, created_at);
  -- 같은 결제/요청으로 두 번 지급되는 것을 DB 수준에서 막습니다.
  CREATE UNIQUE INDEX idx_ledger_ref ON credit_ledger(reason, ref) WHERE ref IS NOT NULL;

  CREATE TABLE payments (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,
    provider_ref TEXT,
    kind         TEXT NOT NULL,          -- 'plan' | 'pack'
    item_id      TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'usd',
    status       TEXT NOT NULL,          -- 'pending' | 'paid' | 'failed' | 'canceled'
    created_at   INTEGER NOT NULL,
    paid_at      INTEGER
  );
  CREATE INDEX idx_payments_user ON payments(user_id, created_at);
  CREATE UNIQUE INDEX idx_payments_provider_ref ON payments(provider, provider_ref)
    WHERE provider_ref IS NOT NULL;

  -- 무드보드/제휴설정/견적 등 스튜디오 상태 동기화용
  CREATE TABLE user_state (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE templates (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    style_id   TEXT NOT NULL,
    space_id   TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    sales      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_templates_user ON templates(user_id, created_at);
  `,

  // 2: 제휴 링크 클릭 추적 + 구독 식별자
  `
  -- 내보낸 제휴 링크. /r/:id 로 리디렉트하면서 클릭을 기록합니다.
  CREATE TABLE links (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sku        TEXT NOT NULL,
    mall_id    TEXT NOT NULL,
    target_url TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'app',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_links_user ON links(user_id, created_at);
  -- 같은 (사용자, 제품, 몰, 채널) 조합은 토큰을 재사용해 통계가 흩어지지 않게 합니다.
  CREATE UNIQUE INDEX idx_links_dedupe ON links(user_id, sku, mall_id, source);

  CREATE TABLE link_clicks (
    id           TEXT PRIMARY KEY,
    link_id      TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    clicked_at   INTEGER NOT NULL,
    referrer     TEXT,
    user_agent   TEXT,
    -- 원문 IP 는 저장하지 않습니다. 일별 솔트를 섞은 해시만 두어
    -- 같은 날 같은 방문자의 중복 클릭만 구분합니다.
    visitor_hash TEXT
  );
  CREATE INDEX idx_clicks_link ON link_clicks(link_id, clicked_at);

  ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
  ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
  `,
]

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get()
  let current = row?.version ?? 0
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run()

  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i])
      db.prepare('UPDATE schema_version SET version = ?').run(i + 1)
    })()
    current = i + 1
  }
  return current
}

export const schemaVersion = migrate()

export const now = () => Date.now()
