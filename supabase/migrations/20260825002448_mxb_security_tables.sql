
CREATE TABLE IF NOT EXISTS mxb_security_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text,
  user_role text,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_log_email ON mxb_security_log(user_email);
CREATE INDEX IF NOT EXISTS idx_security_log_action ON mxb_security_log(action);
CREATE INDEX IF NOT EXISTS idx_security_log_created ON mxb_security_log(created_at DESC);
ALTER TABLE mxb_security_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS mxb_admin_roles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin','financial_admin','editor','moderator','support','developer')),
  created_by text,
  created_at timestamptz DEFAULT now(),
  last_login timestamptz,
  mfa_required boolean DEFAULT true,
  is_active boolean DEFAULT true
);
ALTER TABLE mxb_admin_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO mxb_admin_roles (email, role, created_by)
VALUES ('soniaboost.ai@gmail.com', 'super_admin', 'system')
ON CONFLICT (email) DO UPDATE SET role = 'super_admin', is_active = true;

CREATE TABLE IF NOT EXISTS mxb_active_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  user_agent text,
  ip_address text,
  last_active timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE mxb_active_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS mxb_login_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  ip_address text,
  attempted_at timestamptz DEFAULT now(),
  success boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON mxb_login_attempts(email, attempted_at DESC);
ALTER TABLE mxb_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS mxb_backup_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  triggered_by text NOT NULL,
  backup_type text DEFAULT 'manual',
  status text DEFAULT 'pending',
  file_path text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  notes text
);
ALTER TABLE mxb_backup_history ENABLE ROW LEVEL SECURITY;
;
