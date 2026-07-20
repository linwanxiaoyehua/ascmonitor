-- P2 数据健壮性：事实字段落库 + 删除从未使用的 jobs 表
-- transactions：ASSN 事件的 subtype / 优惠信息 / 试用标记
ALTER TABLE transactions ADD COLUMN event_subtype TEXT;
ALTER TABLE transactions ADD COLUMN offer_type INTEGER;
ALTER TABLE transactions ADD COLUMN offer_discount_type TEXT;
ALTER TABLE transactions ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0;

-- subscriptions：降级待生效产品 / 涨价同意状态 / 试用漏斗时间点 / 过期原因
ALTER TABLE subscriptions ADD COLUMN pending_product_id TEXT;
ALTER TABLE subscriptions ADD COLUMN price_increase_status TEXT;
ALTER TABLE subscriptions ADD COLUMN trial_started_at INTEGER;
ALTER TABLE subscriptions ADD COLUMN converted_at INTEGER;
ALTER TABLE subscriptions ADD COLUMN expiration_intent TEXT;

-- reviews：asc/rss 双源同评论去重（指向 canonical 评论 id）
ALTER TABLE reviews ADD COLUMN dup_of TEXT;

-- jobs 表只有 DDL 从未使用（config 游标模式已覆盖分片语义），按 as-built 原则删除
DROP TABLE IF EXISTS jobs;
