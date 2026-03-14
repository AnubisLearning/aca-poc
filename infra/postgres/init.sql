-- ─────────────────────────────────────────────────
-- ACA – Automated Canary Analysis
-- Shared PostgreSQL schema
-- ─────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Config Service ──────────────────────────────

CREATE TABLE IF NOT EXISTS canary_configs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    metrics     JSONB        NOT NULL DEFAULT '[]',
    canary_selector   JSONB  NOT NULL DEFAULT '{}',
    baseline_selector JSONB  NOT NULL DEFAULT '{}',
    analysis_duration INTEGER NOT NULL DEFAULT 300,  -- seconds
    step_interval     INTEGER NOT NULL DEFAULT 30,   -- seconds
    pass_threshold    FLOAT   NOT NULL DEFAULT 75.0,
    marginal_threshold FLOAT  NOT NULL DEFAULT 50.0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Job Manager ──────────────────────────────────

CREATE TYPE job_status AS ENUM (
    'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id   UUID        NOT NULL REFERENCES canary_configs(id),
    status      job_status  NOT NULL DEFAULT 'pending',
    start_time  TIMESTAMPTZ,
    end_time    TIMESTAMPTZ,
    duration    INTEGER     NOT NULL DEFAULT 300,  -- override from config
    progress    FLOAT       NOT NULL DEFAULT 0.0,  -- 0.0 – 1.0
    error_msg   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_config_id  ON analysis_jobs(config_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON analysis_jobs(status);

-- ── Results Service ───────────────────────────────

CREATE TYPE recommendation AS ENUM ('rollout', 'rollback', 'inconclusive');

CREATE TABLE IF NOT EXISTS analysis_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID        NOT NULL REFERENCES analysis_jobs(id),
    config_id       UUID        NOT NULL REFERENCES canary_configs(id),
    score           FLOAT       NOT NULL,
    recommendation  recommendation NOT NULL,
    metric_scores   JSONB       NOT NULL DEFAULT '[]',
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_job_id    ON analysis_results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_config_id ON analysis_results(config_id);

-- ── Intermediate snapshots (real-time progress) ──

CREATE TABLE IF NOT EXISTS analysis_snapshots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID        NOT NULL REFERENCES analysis_jobs(id),
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    score       FLOAT,
    metric_scores JSONB     NOT NULL DEFAULT '[]',
    progress    FLOAT       NOT NULL DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_job_id ON analysis_snapshots(job_id);
