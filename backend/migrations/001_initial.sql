CREATE TABLE users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user_expiry_idx ON sessions(user_id, expires_at);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE api_tokens (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  masked_token TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  validation_status TEXT NOT NULL DEFAULT 'unknown' CHECK (validation_status IN ('unknown', 'valid', 'invalid', 'expired')),
  connection_status TEXT NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown', 'online', 'degraded', 'offline')),
  expires_at TIMESTAMPTZ,
  expires_at_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_error_code TEXT,
  last_error_message TEXT,
  last_validated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_tokens_enabled_idx ON api_tokens(enabled);

CREATE TABLE servers (
  uuid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hostname TEXT,
  state TEXT NOT NULL DEFAULT 'unknown',
  zone TEXT,
  core_number INTEGER NOT NULL DEFAULT 0 CHECK (core_number >= 0),
  memory_mib BIGINT NOT NULL DEFAULT 0 CHECK (memory_mib >= 0),
  plan TEXT,
  os_name TEXT,
  upcloud_created_at TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_status TEXT NOT NULL DEFAULT 'unknown' CHECK (sync_status IN ('unknown', 'ok', 'degraded', 'error', 'not_found')),
  last_error_message TEXT,
  last_synced_at TIMESTAMPTZ,
  details_synced_at TIMESTAMPTZ,
  last_sync_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX servers_state_idx ON servers(state);
CREATE INDEX servers_zone_idx ON servers(zone);
CREATE INDEX servers_title_lower_idx ON servers(lower(title));
CREATE INDEX servers_last_synced_idx ON servers(last_synced_at);

CREATE TABLE token_server_memberships (
  token_id UUID NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  server_uuid TEXT NOT NULL REFERENCES servers(uuid) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  PRIMARY KEY (token_id, server_uuid)
);
CREATE INDEX token_memberships_server_active_idx ON token_server_memberships(server_uuid, active);
CREATE INDEX token_memberships_token_active_idx ON token_server_memberships(token_id, active);

CREATE TABLE token_server_groups (
  token_id UUID NOT NULL,
  server_uuid TEXT NOT NULL,
  slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, server_uuid),
  UNIQUE (token_id, slot),
  FOREIGN KEY (token_id, server_uuid) REFERENCES token_server_memberships(token_id, server_uuid) ON DELETE CASCADE
);

CREATE TABLE server_storage (
  server_uuid TEXT NOT NULL REFERENCES servers(uuid) ON DELETE CASCADE,
  storage_uuid TEXT NOT NULL,
  title TEXT,
  size_gib NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (size_gib >= 0),
  tier TEXT,
  device_type TEXT,
  address TEXT,
  boot_disk BOOLEAN,
  part_of_plan BOOLEAN,
  zone TEXT,
  attached BOOLEAN NOT NULL DEFAULT TRUE,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_uuid, storage_uuid)
);
CREATE INDEX server_storage_uuid_idx ON server_storage(storage_uuid);

CREATE TABLE server_networks (
  server_uuid TEXT NOT NULL REFERENCES servers(uuid) ON DELETE CASCADE,
  interface_index INTEGER NOT NULL,
  network_uuid TEXT,
  network_type TEXT,
  mac_address TEXT,
  bootable BOOLEAN,
  source_ip_filtering BOOLEAN,
  ip_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_uuid, interface_index)
);
CREATE INDEX server_networks_network_idx ON server_networks(network_uuid);

CREATE TABLE server_metrics (
  id BIGSERIAL PRIMARY KEY,
  server_uuid TEXT NOT NULL REFERENCES servers(uuid) ON DELETE CASCADE,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_period TEXT NOT NULL,
  cpu_percent DOUBLE PRECISION,
  disk_read_bytes_per_second DOUBLE PRECISION,
  disk_write_bytes_per_second DOUBLE PRECISION,
  network_in_bits_per_second DOUBLE PRECISION,
  network_out_bits_per_second DOUBLE PRECISION,
  raw_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX server_metrics_server_time_idx ON server_metrics(server_uuid, sampled_at DESC);
CREATE INDEX server_metrics_sampled_idx ON server_metrics(sampled_at);

CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('token_sync', 'server_sync', 'server_control')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'verifying', 'succeeded', 'failed', 'verification_timeout')),
  token_id UUID REFERENCES api_tokens(id) ON DELETE SET NULL,
  server_uuid TEXT REFERENCES servers(uuid) ON DELETE SET NULL,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'automatic', 'retry')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_jobs_created_idx ON sync_jobs(created_at DESC);
CREATE INDEX sync_jobs_token_idx ON sync_jobs(token_id, created_at DESC);
CREATE INDEX sync_jobs_server_idx ON sync_jobs(server_uuid, created_at DESC);
CREATE UNIQUE INDEX sync_jobs_one_active_token_idx ON sync_jobs(token_id)
  WHERE job_type = 'token_sync' AND status IN ('queued', 'running', 'verifying');
CREATE UNIQUE INDEX sync_jobs_one_active_server_idx ON sync_jobs(server_uuid)
  WHERE job_type IN ('server_sync', 'server_control') AND status IN ('queued', 'running', 'verifying');

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'accepted', 'info')),
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs(user_id, created_at DESC);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings(key, value) VALUES
  ('syncIntervalSeconds', '300'),
  ('serverPollSeconds', '30'),
  ('metricsRefreshSeconds', '300'),
  ('metricsRetentionDays', '30');
