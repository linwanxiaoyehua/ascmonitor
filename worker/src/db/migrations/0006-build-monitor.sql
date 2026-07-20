-- 构建 / 审核状态监控（ASC Webhook 推送 + 每日对账兜底）
-- 已有库升级用；新库由 schema.sql 直接建出

-- alert_events 增加 app_id：告警与构建事件都能按 App 筛选，
-- 动态流原先只对 ASSN 事件生效的 App 过滤，现在对 alert 侧也成立
ALTER TABLE alert_events ADD COLUMN app_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_alert_events_app ON alert_events(app_id, fired_at);

-- 语义色随事件一起存：构建状态里「审核通过」和「审核被拒」不能同色，
-- 而状态枚举 → 颜色的映射只应存在于后端一处，前端不再维护第二份
ALTER TABLE alert_events ADD COLUMN tone TEXT;

-- 构建与版本的「当前状态」快照。
-- 只存最新态：变化检测靠它去重（webhook 可能重投，对账轮询也会重复看到同一状态），
-- 状态流转的历史记录进 alert_events，与告警共用动态流。
CREATE TABLE IF NOT EXISTS build_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  -- build     = 构建处理状态（processingState）
  -- testflight = 外部测试状态（externalBuildState，含 Beta 审核流转）
  -- appstore  = 上架审核状态（appVersionState）
  scope TEXT NOT NULL,
  entity_id TEXT NOT NULL,        -- ASC 资源 id（build id / appStoreVersion id）
  version TEXT,                   -- 版本号 1.2.3
  build_number TEXT,              -- 构建号 42
  state TEXT NOT NULL,            -- 枚举原值，如 VALID / BETA_APPROVED / IN_REVIEW
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(scope, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_build_states_app ON build_states(app_id, updated_at);
