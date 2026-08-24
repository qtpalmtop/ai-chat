-- 启用 pgcrypto：用于 gen_random_uuid()（PostgreSQL 13+ 也可用 pgcrypto）
-- 注：PostgreSQL 13+ 自带 gen_random_uuid()，这里留作兼容低版本
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 统一时区
SET TIME ZONE 'UTC';
