
CREATE TABLE IF NOT EXISTS mxb_config (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

-- Seed default welcome message
INSERT INTO mxb_config (key, value) VALUES
  ('welcome_message', '¡Bienvenida a The Portal! Este es tu espacio exclusivo dentro del universo Movies × Brands.')
ON CONFLICT (key) DO NOTHING;

-- Allow anon to read config (portal fetches it)
ALTER TABLE mxb_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read config" ON mxb_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin write config" ON mxb_config FOR ALL TO authenticated USING (auth.jwt() ->> 'role' = 'admin') WITH CHECK (auth.jwt() ->> 'role' = 'admin');
;
