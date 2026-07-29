-- 订阅历史时间线：原始通知认领 original_transaction_id + 修复被覆盖的 event_type
--
-- 1) notifications_raw 加 original_transaction_id
--    不产生新交易的事件（降级、取消续费、扣款失败、过期…）在 transactions 里只是 upsert 到已有行，
--    raw_uuid 停留在首次创建该交易的那条通知上 —— 于是这些事件在「某个订阅的历史」里查不出来。
--    补一列直接认领订阅号，时间线才能按 original_transaction_id 拉全所有事件。
--    新通知由 webhook 实时写入；历史行先按 raw_uuid 认领（下方 UPDATE），
--    剩下的（合并进已有交易、没有 raw_uuid 指向的那些）需跑一次「数据运维 → 重放通知」补齐。
--
-- 2) 修复 event_type 被后续事件覆盖导致的收入漏算
--    旧的 upsert 只保护了退款系列，其余事件（DID_CHANGE_RENEWAL_STATUS / DOWNGRADE /
--    DID_FAIL_TO_RENEW / EXPIRED…）都会把交易的 event_type 改成自己 —— 一笔续费被改写后
--    不再匹配收入口径（event_type IN SUBSCRIBED/DID_RENEW/ONE_TIME_CHARGE/OFFER_REDEEMED），
--    收入、MRR、LTV 全都少算。代码侧已改为「首次写入后不再改写」，这里把历史行按
--    raw_uuid 指向的原始通知类型还原。

ALTER TABLE notifications_raw ADD COLUMN original_transaction_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_otid ON notifications_raw(original_transaction_id, received_at);

-- 历史通知认领订阅号：能靠 raw_uuid 关联到交易的那部分
UPDATE notifications_raw SET original_transaction_id = (
  SELECT t.original_transaction_id FROM transactions t WHERE t.raw_uuid = notifications_raw.uuid
)
WHERE original_transaction_id IS NULL
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.raw_uuid = notifications_raw.uuid);

-- 还原被覆盖的事件类型（raw_uuid 指向的就是「创建该交易的通知」）
UPDATE transactions SET
  event_type = (SELECT n.type FROM notifications_raw n WHERE n.uuid = transactions.raw_uuid),
  event_subtype = (SELECT n.subtype FROM notifications_raw n WHERE n.uuid = transactions.raw_uuid)
WHERE raw_uuid IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM notifications_raw n
    WHERE n.uuid = transactions.raw_uuid AND n.type != transactions.event_type
  );

-- 注意：metrics_daily / cohorts 是物化结果。本次迁移改了收入口径命中的行，
-- 迁移后需重跑「数据运维 → 重算指标」与「重算 LTV cohort」，历史曲线才会补回被漏算的收入。
