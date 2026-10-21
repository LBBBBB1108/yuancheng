CREATE TABLE administrators (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX administrators_username_lower_uidx
  ON administrators (lower(username));

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (permissions <@ ARRAY['admins.manage','devices.read','devices.manage','sessions.view','sessions.control','files.upload','files.download','audit.read']::text[])
);

CREATE TABLE administrator_roles (
  administrator_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (administrator_id, role_id)
);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY,
  administrator_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  csrf_token_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  user_agent text,
  ip_address inet
);

CREATE TABLE device_groups (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  group_id uuid REFERENCES device_groups(id) ON DELETE SET NULL,
  public_key text NOT NULL UNIQUE,
  os_version text NOT NULL,
  client_version text NOT NULL,
  enrolled_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  local_assistance_enabled boolean NOT NULL DEFAULT true
);

CREATE INDEX devices_active_idx ON devices (last_seen_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE pairing_tokens (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  requested_device_name text NOT NULL,
  created_by uuid NOT NULL REFERENCES administrators(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_device_id uuid REFERENCES devices(id),
  CHECK (expires_at > created_at)
);

CREATE TABLE admin_device_grants (
  administrator_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  permissions text[] NOT NULL,
  granted_by uuid NOT NULL REFERENCES administrators(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (administrator_id, device_id),
  CHECK (permissions <@ ARRAY['view','control','files.upload','files.download']::text[])
);

CREATE TABLE test_authorizations (
  device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  administrator_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  valid_until timestamptz NOT NULL,
  renewed_by uuid NOT NULL REFERENCES administrators(id),
  renewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE remote_sessions (
  id uuid PRIMARY KEY,
  administrator_id uuid NOT NULL REFERENCES administrators(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  requested_permissions text[] NOT NULL,
  granted_permissions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('pending','authorized','active','rejected','timed_out','ended')),
  mode text NOT NULL CHECK (mode IN ('test','production')),
  requested_at timestamptz NOT NULL,
  authorized_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  CHECK (requested_permissions <@ ARRAY['view','control','files.upload','files.download']::text[]),
  CHECK (granted_permissions <@ requested_permissions)
);

CREATE INDEX remote_sessions_device_status_idx ON remote_sessions (device_id, status);

CREATE TABLE control_leases (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES remote_sessions(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  administrator_id uuid NOT NULL REFERENCES administrators(id),
  acquired_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text
);

CREATE UNIQUE INDEX control_leases_one_active_per_device_uidx
  ON control_leases (device_id)
  WHERE released_at IS NULL;

CREATE TABLE file_transfers (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES remote_sessions(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('upload','download')),
  relative_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 104857600),
  sha256 char(64),
  status text NOT NULL CHECK (status IN ('pending','transferring','completed','failed','cancelled')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_reason text
);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  administrator_id uuid REFERENCES administrators(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  session_id uuid REFERENCES remote_sessions(id) ON DELETE SET NULL,
  file_transfer_id uuid REFERENCES file_transfers(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failed')),
  metadata jsonb NOT NULL DEFAULT '{}',
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_device_idx ON audit_events (device_id, occurred_at DESC);
