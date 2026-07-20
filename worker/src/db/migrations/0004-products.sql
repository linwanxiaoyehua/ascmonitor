-- 产品目录：内购/订阅的 product_id → 名称映射（ASC API 每日同步）
-- 展示层用名称替代裸 product_id
CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  app_id INTEGER,
  name TEXT NOT NULL,            -- ASC referenceName
  type TEXT,                     -- subscription | CONSUMABLE | NON_CONSUMABLE | NON_RENEWING_SUBSCRIPTION
  fetched_at INTEGER NOT NULL
);
