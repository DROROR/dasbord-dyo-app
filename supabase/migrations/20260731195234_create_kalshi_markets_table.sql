
CREATE TABLE IF NOT EXISTS public.kalshi_markets (
  id BIGSERIAL PRIMARY KEY,
  ticker TEXT UNIQUE NOT NULL,
  title TEXT,
  event_ticker TEXT,
  series_ticker TEXT,
  category TEXT,
  yes_bid NUMERIC,
  yes_ask NUMERIC,
  no_bid NUMERIC,
  no_ask NUMERIC,
  volume NUMERIC,
  open_interest NUMERIC,
  status TEXT,
  open_time TIMESTAMPTZ,
  close_time TIMESTAMPTZ,
  result TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kalshi_markets_status ON public.kalshi_markets(status);
CREATE INDEX IF NOT EXISTS idx_kalshi_markets_category ON public.kalshi_markets(category);
CREATE INDEX IF NOT EXISTS idx_kalshi_markets_last_updated ON public.kalshi_markets(last_updated);
;
