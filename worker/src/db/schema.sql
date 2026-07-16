-- ASCMonitor D1 schema
-- 金额统一以 milli-units 整数存储（Apple price 字段即毫单位）；时间统一 UTC ISO8601 / epoch ms

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asc_app_id TEXT,              -- App Store Connect / iTunes 数字 ID（评论抓取用）
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- 单用户配置存储：ASC 凭证、VAPID 密钥、dashboard access token、telegram token 等
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ASSN V2 原始通知，append-only；uuid 主键实现幂等去重
CREATE TABLE IF NOT EXISTS notifications_raw (
  uuid TEXT PRIMARY KEY,
  app_id INTEGER,
  type TEXT NOT NULL,
  subtype TEXT,
  signed_payload TEXT NOT NULL,
  decoded_json TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_notifications_received ON notifications_raw(received_at);

-- 交易明细（一次性购买 + 订阅每期）
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL,
  app_id INTEGER,
  product_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- Auto-Renewable Subscription / Consumable / Non-Consumable / Non-Renewing Subscription
  price_milli INTEGER,
  currency TEXT,
  country TEXT,
  purchase_date INTEGER,
  expires_date INTEGER,
  event_type TEXT NOT NULL,     -- 触发本条记录的 ASSN notificationType
  refunded INTEGER NOT NULL DEFAULT 0,
  raw_uuid TEXT                 -- 关联 notifications_raw.uuid
);
CREATE INDEX IF NOT EXISTS idx_tx_original ON transactions(original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_purchase ON transactions(purchase_date);

-- 订阅当前状态（物化）
CREATE TABLE IF NOT EXISTS subscriptions (
  original_transaction_id TEXT PRIMARY KEY,
  app_id INTEGER,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,         -- trial | active | grace_period | billing_retry | expired | revoked
  auto_renew INTEGER NOT NULL DEFAULT 1,
  period TEXT,                  -- P1M / P1Y ...
  price_milli INTEGER,
  currency TEXT,
  country TEXT,
  started_at INTEGER,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

-- 指标日快照
CREATE TABLE IF NOT EXISTS metrics_daily (
  app_id INTEGER NOT NULL,
  date TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
  revenue_milli INTEGER NOT NULL DEFAULT 0,
  new_subs INTEGER NOT NULL DEFAULT 0,
  renewals INTEGER NOT NULL DEFAULT 0,
  refunds INTEGER NOT NULL DEFAULT 0,
  active_subs INTEGER NOT NULL DEFAULT 0,
  mrr_milli INTEGER NOT NULL DEFAULT 0,
  trial_starts INTEGER NOT NULL DEFAULT 0,
  trial_conversions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, date)
);

-- 评论（source: 'asc' 可回复 | 'rss' 各国公开评论）
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,          -- `${source}:${外部id}`
  app_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  country TEXT,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  reviewer TEXT,
  review_version TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_app_time ON reviews(app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(app_id, rating);

CREATE TABLE IF NOT EXISTS review_tags (
  review_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (review_id, tag)
);

-- 关键词打标规则（pattern 为大小写不敏感正则）
CREATE TABLE IF NOT EXISTS tag_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  pattern TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ratings_snapshots (
  app_id INTEGER NOT NULL,
  country TEXT NOT NULL,
  date TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
  avg_rating REAL,
  ratings_count INTEGER,
  PRIMARY KEY (app_id, country, date)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,               -- NULL = 所有 App
  kind TEXT NOT NULL,           -- new_bad_review | bad_review_rate | revenue_drop | webhook_silent
  params_json TEXT NOT NULL DEFAULT '{}',
  channels_json TEXT NOT NULL DEFAULT '["push"]',
  silence_min INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER
);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  fired_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_events_time ON alert_events(fired_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- cron 任务表（队列语义：游标分片、重试、死信）
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  cursor TEXT,
  run_after INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'  -- pending | running | done | dead
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status, run_after);

-- 默认告警规则
INSERT OR IGNORE INTO alert_rules (id, app_id, kind, params_json, channels_json, silence_min, enabled) VALUES
  (1, NULL, 'new_bad_review', '{"max_rating":2}', '["push"]', 0, 1),
  (2, NULL, 'bad_review_rate', '{"threshold_pct":30,"min_count":5}', '["push"]', 720, 1),
  (3, NULL, 'revenue_drop', '{"drop_pct":30}', '["push"]', 720, 1),
  (4, NULL, 'webhook_silent', '{"hours":24}', '["push"]', 720, 1);

-- 默认打标规则
INSERT OR IGNORE INTO tag_rules (id, tag, pattern, enabled) VALUES
  (1, '崩溃', 'crash|closes|freez|闪退|崩溃|卡死|打不开', 1),
  (2, '价格', 'price|expensive|too much|subscription cost|太贵|价格|订阅费|收费', 1),
  (3, '功能请求', 'please add|would be great|feature request|wish|希望|建议|求加', 1),
  (4, '广告', 'ads|advert|广告', 1),
  (5, '登录/账号', 'login|sign in|account|password|登录|账号|密码', 1),
  (6, '同步/数据丢失', 'sync|lost.*data|data.*lost|同步|数据丢失|丢失', 1);
