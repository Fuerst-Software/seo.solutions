-- seo.solutions Database Schema
-- Compatible with PostgreSQL / MySQL / SQLite

-- Users
CREATE TABLE users (
  id          VARCHAR(36)  PRIMARY KEY,
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(255),
  password    VARCHAR(255) NOT NULL,  -- bcrypt hashed
  plan        VARCHAR(50)  DEFAULT 'free',
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- Websites connected by users
CREATE TABLE websites (
  id          VARCHAR(36)  PRIMARY KEY,
  user_id     VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         VARCHAR(500) NOT NULL,
  name        VARCHAR(255),
  keywords    TEXT,
  lang        VARCHAR(10)  DEFAULT 'de',
  api_key     VARCHAR(64)  UNIQUE NOT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_websites_user ON websites(user_id);
CREATE INDEX idx_websites_api_key ON websites(api_key);

-- Content Zones (areas on a website managed by AI)
CREATE TABLE content_zones (
  id              VARCHAR(36)  PRIMARY KEY,
  website_id      VARCHAR(36)  NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  zone_id         VARCHAR(255) NOT NULL,  -- matches data-seo-zone attribute
  zone_type       VARCHAR(50)  DEFAULT 'text',  -- text | headline | meta | alt | title
  prompt          TEXT,
  current_content TEXT,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (website_id, zone_id)
);

CREATE INDEX idx_zones_website ON content_zones(website_id);

-- Content Versions (history of AI-generated content)
CREATE TABLE content_versions (
  id          VARCHAR(36)  PRIMARY KEY,
  zone_id     VARCHAR(36)  NOT NULL REFERENCES content_zones(id) ON DELETE CASCADE,
  content     TEXT         NOT NULL,
  model       VARCHAR(100),
  tokens_used INT,
  seo_score   INT,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_versions_zone ON content_versions(zone_id);

-- AI Jobs (scheduled or manual content generation tasks)
CREATE TABLE ai_jobs (
  id          VARCHAR(36)  PRIMARY KEY,
  zone_id     VARCHAR(36)  NOT NULL REFERENCES content_zones(id) ON DELETE CASCADE,
  website_id  VARCHAR(36)  NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  job_type    VARCHAR(50)  DEFAULT 'optimize',  -- optimize | rewrite | expand | shorten | translate
  schedule    VARCHAR(50)  DEFAULT 'daily',     -- once | daily | weekly | manual
  status      VARCHAR(50)  DEFAULT 'pending',   -- pending | running | success | error
  last_run    TIMESTAMP,
  next_run    TIMESTAMP,
  error_msg   TEXT,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jobs_zone ON ai_jobs(zone_id);
CREATE INDEX idx_jobs_status ON ai_jobs(status);
CREATE INDEX idx_jobs_next_run ON ai_jobs(next_run);

-- Activity Log
CREATE TABLE activity_log (
  id          SERIAL       PRIMARY KEY,
  user_id     VARCHAR(36)  REFERENCES users(id) ON DELETE SET NULL,
  website_id  VARCHAR(36)  REFERENCES websites(id) ON DELETE SET NULL,
  event       VARCHAR(255) NOT NULL,
  details     TEXT,
  status      VARCHAR(50),
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_user ON activity_log(user_id);
CREATE INDEX idx_activity_created ON activity_log(created_at);

-- API Usage Tracking
CREATE TABLE api_usage (
  id            SERIAL   PRIMARY KEY,
  user_id       VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  job_id        VARCHAR(36) REFERENCES ai_jobs(id) ON DELETE SET NULL,
  model         VARCHAR(100),
  input_tokens  INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd      DECIMAL(10, 6) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_user ON api_usage(user_id);
