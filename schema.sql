-- ==========================================================================
-- FANTASY ETF LEAGUE - DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Run this in the Supabase SQL Editor to set up your tables!
-- ==========================================================================

-- Clean up existing tables if running this again (Optional)
DROP TABLE IF EXISTS history CASCADE;
DROP TABLE IF EXISTS baskets CASCADE;
DROP TABLE IF EXISTS etf_prices CASCADE;
DROP TABLE IF EXISTS players CASCADE;

-- 1. Create Players Table
CREATE TABLE players (
    id TEXT PRIMARY KEY,                       -- Short identifier (e.g. 'nate', 'alice')
    name TEXT NOT NULL,                        -- Display name (e.g. 'Nate', 'Alice')
    starting_capital NUMERIC(12,2) DEFAULT 100000.00,
    cash NUMERIC(12,2) DEFAULT 100000.00
);

-- 2. Create Baskets Table (Individual ETF holdings per player)
CREATE TABLE baskets (
    id SERIAL PRIMARY KEY,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,                      -- ETF Symbol (e.g. 'SPY', 'QQQ')
    shares NUMERIC(10,4) NOT NULL,             -- Support fractional shares
    purchase_price NUMERIC(10,2) NOT NULL,     -- Cost basis
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
-- Enables anyone to view the leaderboard/portfolios, but locks down writing.
-- Writes are performed via Vercel using the Supabase Service Role Key.
-- ==========================================================================

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE etf_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;

-- Allow Public Read-Only Access
CREATE POLICY "Allow public read access on players" ON players FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on baskets" ON baskets FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on etf_prices" ON etf_prices FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public read access on history" ON history FOR SELECT TO anon USING (true);

-- ==========================================================================
-- SEED INITIAL DATA
-- ==========================================================================

-- Insert Players
INSERT INTO players (id, name, starting_capital, cash) VALUES
('nate', 'Nate', 100000.00, 14640.00),
('alice', 'Alice', 100000.00, 11893.00),
('bob', 'Bob', 100000.00, 21980.00),
('charlie', 'Charlie', 100000.00, 17640.00);

-- Insert Baskets (ETF Holdings)
INSERT INTO baskets (player_id, symbol, shares, purchase_price) VALUES
('nate', 'SPY', 100, 505.20),
('nate', 'QQQ', 80, 435.50),

('alice', 'VOO', 120, 465.10),
('alice', 'GLD', 150, 215.30),

('bob', 'SMH', 200, 220.10),
('bob', 'ARKK', 800, 42.50),

('charlie', 'SCHD', 500, 78.20),
('charlie', 'BND', 600, 72.10);

-- Insert Initial ETF Prices Cache
INSERT INTO etf_prices (symbol, current_price, last_updated) VALUES
('SPY', 733.73, NOW()),
('QQQ', 701.53, NOW()),
('VOO', 674.59, NOW()),
('GLD', 411.50, NOW()),
('SMH', 543.96, NOW()),
('ARKK', 73.84, NOW()),
('SCHD', 32.10, NOW()),
('BND', 72.45, NOW());

-- Insert History snap shots
INSERT INTO history (date, player_id, portfolio_value) VALUES
('2026-05-12', 'nate', 100000.00),
('2026-05-12', 'alice', 100000.00),
('2026-05-12', 'bob', 100000.00),
('2026-05-12', 'charlie', 100000.00),

('2026-05-13', 'nate', 101250.00),
('2026-05-13', 'alice', 100800.00),
('2026-05-13', 'bob', 99400.00),
('2026-05-13', 'charlie', 100200.00),

('2026-05-14', 'nate', 102100.00),
('2026-05-14', 'alice', 101500.00),
('2026-05-14', 'bob', 100500.00),
('2026-05-14', 'charlie', 100100.00),

('2026-05-15', 'nate', 101900.00),
('2026-05-15', 'alice', 102200.00),
('2026-05-15', 'bob', 101200.00),
('2026-05-15', 'charlie', 99800.00),

('2026-05-18', 'nate', 103400.00),
('2026-05-18', 'alice', 101900.00),
('2026-05-18', 'bob', 103800.00),
('2026-05-18', 'charlie', 99950.00),

('2026-05-19', 'nate', 144135.40),
('2026-05-19', 'alice', 154568.80),
('2026-05-19', 'bob', 189844.00),
('2026-05-19', 'charlie', 77160.00);
