-- ==========================================================================
-- FANTASY ETF LEAGUE - DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Clean start for May 20 with FUSD, Live Trade Portal & Activity Log
-- ==========================================================================

-- Clean up existing tables
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS history CASCADE;
DROP TABLE IF EXISTS baskets CASCADE;
DROP TABLE IF EXISTS etf_prices CASCADE;
DROP TABLE IF EXISTS players CASCADE;

-- 1. Create Players Table (Now includes 4-digit security PIN)
CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starting_capital NUMERIC(12,2) DEFAULT 100000.00,
    cash NUMERIC(12,2) DEFAULT 0.00,
    pin TEXT NOT NULL
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

-- 5. Create Trades Table (Real-time activity feed)
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    symbol TEXT NOT NULL,
    shares NUMERIC(12,4) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================================================
-- SECURITY POLICIES (Row Level Security - RLS)
-- Enables anyone to read, and allows public write access for executing trades.
-- ==========================================================================

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE etf_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Players Policies
CREATE POLICY "Allow public read access on players" ON players FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public update on players" ON players FOR UPDATE TO anon USING (true);

-- Baskets Policies (Allows buying/selling from browser)
CREATE POLICY "Allow public read access on baskets" ON baskets FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert on baskets" ON baskets FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update on baskets" ON baskets FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow public delete on baskets" ON baskets FOR DELETE TO anon USING (true);

-- ETF Prices & History Policies (Read-only for public, writes reserved for backend service role)
CREATE POLICY "Allow public read access on etf_prices" ON etf_prices FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on history" ON history FOR SELECT TO anon USING (true);

-- Trades Policies (Allows public insert to log transactions and read for feed)
CREATE POLICY "Allow public read access on trades" ON trades FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert on trades" ON trades FOR INSERT TO anon WITH CHECK (true);

-- ==========================================================================
-- SEED INITIAL CLEAN START DATA (FUSD @ $1.00)
-- ==========================================================================

-- Insert Players (Seeded with secret words & available cash)
INSERT INTO players (id, name, starting_capital, cash, pin) VALUES
('dan', 'Dan', 100000.00, 60000.00, 'daniel'),
('zach', 'Zach', 100000.00, 70000.00, 'zachary'),
('chris', 'Chris', 100000.00, 82500.00, 'christian'),
('nate', 'Nate', 100000.00, 64000.00, 'nathan');

-- Insert baskets: Seed portfolios totaling $100,000 for each player
INSERT INTO baskets (player_id, symbol, shares, purchase_price) VALUES
('dan', 'SPY', 100, 400.00),     -- $40,000 in SPY
('zach', 'QQQ', 100, 300.00),    -- $30,000 in QQQ
('chris', 'VOO', 50, 350.00),    -- $17,500 in VOO
('nate', 'GLD', 200, 180.00);    -- $36,000 in GLD

-- Insert ETF Prices Cache (Seeding base prices for SPY, QQQ, VOO, GLD)
INSERT INTO etf_prices (symbol, current_price, last_updated) VALUES
('FUSD', 1.00, NOW()),
('SPY', 400.00, NOW()),
('QQQ', 300.00, NOW()),
('VOO', 350.00, NOW()),
('GLD', 180.00, NOW());

-- Insert Starting History Record for May 19
INSERT INTO history (date, player_id, portfolio_value) VALUES
('2026-05-19', 'dan', 100000.00),
('2026-05-19', 'zach', 100000.00),
('2026-05-19', 'chris', 100000.00),
('2026-05-19', 'nate', 100000.00);

-- Seed Initial Trades to populate the Activity Feed
INSERT INTO trades (player_id, action, symbol, shares, price, created_at) VALUES
('dan', 'BUY', 'SPY', 100, 400.00, NOW() - INTERVAL '20 minutes'),
('zach', 'BUY', 'QQQ', 100, 300.00, NOW() - INTERVAL '15 minutes'),
('chris', 'BUY', 'VOO', 50, 350.00, NOW() - INTERVAL '10 minutes'),
('nate', 'BUY', 'GLD', 200, 180.00, NOW() - INTERVAL '5 minutes');
