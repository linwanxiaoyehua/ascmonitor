-- 沙盒隔离：交易与订阅记录环境标，收入 / 订阅 / 漏斗 / LTV 全部只算 Production
-- 原先沙盒事件与真实交易一起写入 transactions / subscriptions，测试内购会虚增收入与活跃订阅。
-- 已有库升级用；新库由 schema.sql 直接建出。

ALTER TABLE transactions ADD COLUMN environment TEXT NOT NULL DEFAULT 'Production';
ALTER TABLE subscriptions ADD COLUMN environment TEXT NOT NULL DEFAULT 'Production';

-- 历史行回填：原始通知里带 data.environment，靠 raw_uuid 认领
UPDATE transactions SET environment = 'Sandbox'
WHERE raw_uuid IN (
  SELECT uuid FROM notifications_raw
  WHERE json_extract(decoded_json, '$.data.environment') = 'Sandbox'
);

-- 订阅没有 raw_uuid，经同一 original_transaction_id 的交易传递
UPDATE subscriptions SET environment = 'Sandbox'
WHERE original_transaction_id IN (
  SELECT original_transaction_id FROM transactions WHERE environment = 'Sandbox'
);

CREATE INDEX IF NOT EXISTS idx_tx_env ON transactions(environment, purchase_date);

-- 注意：metrics_daily / cohorts 是物化结果，本次迁移不动。
-- 迁移后需重跑一次「数据运维 → 重算指标」与「重算 LTV cohort」，历史曲线才会去掉沙盒。
