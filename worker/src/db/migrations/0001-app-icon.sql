-- 已有库升级：apps 表增加 icon_url（新库由 schema.sql 直接建出）
ALTER TABLE apps ADD COLUMN icon_url TEXT;
