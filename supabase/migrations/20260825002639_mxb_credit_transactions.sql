
CREATE TABLE IF NOT EXISTS mxb_credit_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  source text NOT NULL,
  idempotency_key text UNIQUE NOT NULL,
  credits_before integer DEFAULT 0,
  credits_after integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_email ON mxb_credit_transactions(email);
CREATE INDEX IF NOT EXISTS idx_credit_tx_idem ON mxb_credit_transactions(idempotency_key);
ALTER TABLE mxb_credit_transactions ENABLE ROW LEVEL SECURITY;
;
