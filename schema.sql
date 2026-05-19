-- ==========================================================================
-- FANTASY ETF LEAGUE - DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Clean start for May 20 with FUSD ($1.00 placeholder ETF)
-- ==========================================================================

-- Clean up existing tables
DROP TABLE IF EXISTS history CASCADE;
DROP TABLE IF EXISTS baskets CASCADE;
DROP TABLE IF EXISTS etf_prices CASCADE;
DROP TABLE IF EXISTS players CASCADE;

-- 1. Create Players Table
CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starting_capital NUMERIC(12,2) DEFAULT 100000.00,
    cash NUMERIC(12,2) DEFAULT 0.00
);

-- 2. Create Baskets Table (Individual ETF holdings per player)
CREATE TABLE baskets (
    id SERIAL PRIMARY KEY,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    shares NUMERIC(12,4) NOT NULL,
    purchase_price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create ETF Prices Table (Caching current prices)
CREATE TABLE etf_prices (
    symbol TEXT PRIMARY KEY,
    current_price NUMERIC(10,2) NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create History Table (Daily portfolio snapshot log)
CREATE TABLE history (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    portfolio_value NUMERIC(12,2) NOT NULL,
    CONSTRAINT unique_date_player UNIQUE (date, player_id)
);

-- ==========================================================================
-- SECURITY POLICIES (Row Level Security - RLS)
-- ==========================================================================

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE etf_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on players" ON players FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on baskets" ON baskets FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on etf_prices" ON etf_prices FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on history" ON history FOR SELECT TO anon USING (true);

-- ==========================================================================
-- SEED INITIAL CLEAN START DATA (FUSD @ $1.00)
-- ==========================================================================

-- Insert Players (Starting with $0 cash, since all $100k is in FUSD)
INSERT INTO players (id, name, starting_capital, cash) VALUES
('nate', 'Nate', 100000.00, 0.00),
('alice', 'Alice', 100000.00, 0.00),
('bob', 'Bob', 100000.00, 0.00),
('charlie', 'Charlie', 100000.00, 0.00);

-- Insert baskets: Everyone holds 100,000 shares of FUSD
INSERT INTO baskets (player_id, symbol, shares, purchase_price) VALUES
('nate', 'FUSD', 100000, 1.00),
('alice', 'FUSD', 100000, 1.00),
('bob', 'FUSD', 100000, 1.00),
('charlie', 'FUSD', 100000, 1.00);

-- Insert ETF Prices Cache
INSERT INTO etf_prices (symbol, current_price, last_updated) VALUES
('FUSD', 1.00, NOW());

-- Insert Starting History Record for May 19 (Day before start)
INSERT INTO history (date, player_id, portfolio_value) VALUES
('2026-05-19', 'nate', 100000.00),
('2026-05-19', 'alice', 100000.00),
('2026-05-19', 'bob', 100000.00),
('2026-05-19', 'charlie', 100000.00);
