-- P4 口碑闭环：评论回复 + 版本对比
-- reviews：开发者回复（仅 asc 源可回复）
ALTER TABLE reviews ADD COLUMN response_body TEXT;
ALTER TABLE reviews ADD COLUMN response_state TEXT;   -- NULL=无回复 | PENDING_PUBLISH | PUBLISHED
ALTER TABLE reviews ADD COLUMN responded_at INTEGER;

-- 版本发布历史（daily Lookup diff 写入；版本前后评分对比用）
CREATE TABLE IF NOT EXISTS app_releases (
  app_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  released_at INTEGER,          -- currentVersionReleaseDate
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, version)
);
