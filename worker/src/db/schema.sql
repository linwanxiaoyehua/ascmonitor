-- ASCMonitor D1 schema
-- 金额统一以 milli-units 整数存储（Apple price 字段即毫单位）；时间统一 UTC ISO8601 / epoch ms

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asc_app_id TEXT,              -- App Store Connect / iTunes 数字 ID（评论抓取用）
  icon_url TEXT,                -- App 图标（iTunes Lookup 自动获取）
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
  received_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  original_transaction_id TEXT     -- 所属订阅 / 原始交易；订阅历史时间线按它拉全部事件
);
CREATE INDEX IF NOT EXISTS idx_notifications_received ON notifications_raw(received_at);
CREATE INDEX IF NOT EXISTS idx_notifications_otid ON notifications_raw(original_transaction_id, received_at);

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
  event_subtype TEXT,           -- ASSN subtype（UPGRADE/DOWNGRADE/INITIAL_BUY…）
  offer_type INTEGER,           -- 1=介绍性优惠 2=促销优惠 3=优惠码
  offer_discount_type TEXT,     -- FREE_TRIAL / PAY_AS_YOU_GO / PAY_UP_FRONT
  is_trial INTEGER NOT NULL DEFAULT 0, -- 免费试用期交易
  refunded INTEGER NOT NULL DEFAULT 0,
  raw_uuid TEXT,                -- 关联 notifications_raw.uuid
  environment TEXT NOT NULL DEFAULT 'Production' -- Production | Sandbox；沙盒不计入任何收入口径
);
CREATE INDEX IF NOT EXISTS idx_tx_original ON transactions(original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_purchase ON transactions(purchase_date);
CREATE INDEX IF NOT EXISTS idx_tx_env ON transactions(environment, purchase_date);

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
  updated_at INTEGER NOT NULL,
  pending_product_id TEXT,      -- 降级后下期生效的产品
  price_increase_status TEXT,   -- PENDING / ACCEPTED（涨价同意状态）
  trial_started_at INTEGER,     -- 试用开始（Trial 漏斗）
  converted_at INTEGER,         -- 试用转正时间（Trial 漏斗）
  expiration_intent TEXT,       -- 过期原因 subtype（VOLUNTARY / BILLING_ERROR…）
  environment TEXT NOT NULL DEFAULT 'Production' -- Production | Sandbox；沙盒不计入活跃 / MRR / 漏斗
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
  fetched_at INTEGER NOT NULL,
  dup_of TEXT,                  -- asc/rss 双源同评论：指向 canonical 评论 id
  response_body TEXT,           -- 开发者回复（仅 asc 源可回复）
  response_state TEXT,          -- NULL=无回复 | PENDING_PUBLISH | PUBLISHED
  responded_at INTEGER
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
  app_id INTEGER,                -- 归属 App（跨 App 告警为 NULL），动态流按 App 筛选用
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  tone TEXT,                     -- 语义色（success/info/warning/danger/neutral），前端直接用，不再自建映射
  fired_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_events_time ON alert_events(fired_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_app ON alert_events(app_id, fired_at);

-- 构建与版本的「当前状态」快照（ASC Webhook 推送 + 每日对账兜底共同维护）。
-- 只存最新态，用于变化检测去重；状态流转历史进 alert_events，与告警共用动态流。
CREATE TABLE IF NOT EXISTS build_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  -- build      = 构建处理状态（processingState）
  -- testflight = 外部测试状态（externalBuildState，含 Beta 审核流转）
  -- appstore   = 上架审核状态（appVersionState）
  scope TEXT NOT NULL,
  entity_id TEXT NOT NULL,       -- ASC 资源 id（build id / appStoreVersion id）
  version TEXT,                  -- 版本号 1.2.3
  build_number TEXT,             -- 构建号 42
  state TEXT NOT NULL,           -- 枚举原值，如 VALID / BETA_APPROVED / IN_REVIEW
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(scope, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_build_states_app ON build_states(app_id, updated_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- （原 jobs 队列表已删除：config 游标模式覆盖分片语义，见 0002 迁移）

-- ASC 每日销售报告（账单口径：Apple 实际结算）
CREATE TABLE IF NOT EXISTS sales_daily (
  date TEXT NOT NULL,            -- YYYY-MM-DD（报告日）
  apple_id TEXT NOT NULL,        -- App Apple ID
  country TEXT NOT NULL,
  product_type TEXT NOT NULL,    -- Product Type Identifier（1*=下载 7*=更新 IA*=内购）
  units INTEGER NOT NULL DEFAULT 0,
  proceeds_milli INTEGER NOT NULL DEFAULT 0, -- 开发者分成（毫单位，原币种）
  currency TEXT NOT NULL DEFAULT 'USD',
  PRIMARY KEY (date, apple_id, country, product_type, currency)
);

-- 版本发布历史（daily Lookup diff 写入，见 0005 迁移）
CREATE TABLE IF NOT EXISTS app_releases (
  app_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  released_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, version)
);

-- 产品目录：product_id → 名称（ASC API 每日同步，见 0004 迁移）
CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  app_id INTEGER,
  name TEXT NOT NULL,            -- ASC referenceName
  type TEXT,                     -- subscription | CONSUMABLE | NON_CONSUMABLE | NON_RENEWING_SUBSCRIPTION
  fetched_at INTEGER NOT NULL
);

-- LTV 月 cohort 物化（weekly cron 全量重算，见 0003 迁移）
CREATE TABLE IF NOT EXISTS cohorts (
  app_id INTEGER NOT NULL,
  cohort_month TEXT NOT NULL,      -- YYYY-MM（订阅 started_at 所在 UTC 月）
  subs INTEGER NOT NULL DEFAULT 0,
  revenue_milli_cum INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (app_id, cohort_month)
);

-- ASC 订阅状态日快照（补全 Webhook 上线前的存量订阅）
CREATE TABLE IF NOT EXISTS subs_snapshot_daily (
  date TEXT NOT NULL,
  apple_id TEXT NOT NULL,
  subscription_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,   -- 标准价 + 已付费介绍价
  trials INTEGER NOT NULL DEFAULT 0,   -- 免费试用中
  PRIMARY KEY (date, apple_id, subscription_name)
);

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
