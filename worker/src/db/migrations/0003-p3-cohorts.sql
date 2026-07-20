-- P3 收入深化：LTV 月 cohort 物化表（唯一物化项，其余指标即时计算）
-- weekly cron 全量重算：subs = 该月新订阅数；revenue_milli_cum = 这些订阅至今的累计收入（USD 毫单位）
CREATE TABLE IF NOT EXISTS cohorts (
  app_id INTEGER NOT NULL,
  cohort_month TEXT NOT NULL,      -- YYYY-MM（订阅 started_at 所在 UTC 月）
  subs INTEGER NOT NULL DEFAULT 0,
  revenue_milli_cum INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (app_id, cohort_month)
);
