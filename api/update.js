// Vercel Serverless Function to update ETF prices and calculate portfolio values
// Scheduled to run every 4 hours daily

import { createClient } from '@supabase/supabase-js';

// Multi-stage price resolver for single symbol fallbacks
async function resolveSinglePrice(symbol, supabase) {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol === 'FUSD') return 1.00;

  // 1. Try Stooq CSV API
  try {
    const url = `https://stooq.com/q/l/?s=${cleanSymbol.toLowerCase()}.us&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length >= 2) {
        const headers = lines[0].split(',');
        const closeIndex = headers.indexOf('Close');
        if (closeIndex !== -1) {
          const data = lines[1].split(',');
          if (data.length > closeIndex) {
            const priceStr = data[closeIndex].trim();
            if (priceStr !== 'N/D') {
              const price = parseFloat(priceStr);
              if (!isNaN(price) && price > 0) {
                return Math.round(price * 100) / 100;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Fallback: Stooq failed for ${cleanSymbol}: ${err.message}`);
  }

  // 2. Try direct Yahoo Finance chart API
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const json = await res.json();
      const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price !== undefined && price !== null) {
        const priceNum = parseFloat(price);
        if (!isNaN(priceNum) && priceNum > 0) {
          return Math.round(priceNum * 100) / 100;
        }
      }
    }
  } catch (err) {
    console.warn(`Fallback: Yahoo Direct failed for ${cleanSymbol}: ${err.message}`);
  }

  // 3. Try Yahoo Finance via AllOrigins proxy
  try {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?range=1d&interval=1d`;
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`;
    const res = await fetch(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const json = await res.json();
      const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price !== undefined && price !== null) {
        const priceNum = parseFloat(price);
        if (!isNaN(priceNum) && priceNum > 0) {
          return Math.round(priceNum * 100) / 100;
        }
      }
    }
  } catch (err) {
    console.warn(`Fallback: AllOrigins Proxy failed for ${cleanSymbol}: ${err.message}`);
  }

  // 4. Try existing price in cache as last resort
  if (supabase) {
    try {
      const { data: cached } = await supabase
        .from('etf_prices')
        .select('current_price')
        .eq('symbol', cleanSymbol)
        .single();

      if (cached && cached.current_price) {
        console.warn(`Fallback: Using cached price for ${cleanSymbol}`);
        return Number(cached.current_price);
      }
    } catch (e) {
      console.error(`Error reading cached price for ${cleanSymbol}:`, e);
    }
  }

  throw new Error(`Failed to resolve price for ${cleanSymbol}`);
}

export default async function handler(request, response) {
  // 1. Authenticate the Cron request in production (only if CRON_SECRET is set in Vercel)
  if (process.env.NODE_ENV === 'production' && process.env.CRON_SECRET) {
    const authHeader = request.headers.get ? request.headers.get('authorization') : request.headers.authorization;
    const querySecret = request.query?.secret;
    
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && querySecret !== process.env.CRON_SECRET) {
      return response.status(401).json({ success: false, error: 'Unauthorized' });
    }
  }

  // 2. Initialize Supabase client using Service Role Key (bypasses RLS to write updates)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return response.status(500).json({
      success: false,
      error: 'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('Loading active assets from Supabase...');
    
    // Fetch unique ETF symbols from baskets
    const { data: baskets, error: basketsError } = await supabase
      .from('baskets')
      .select('symbol');

    if (basketsError) throw basketsError;
    
    const symbols = [...new Set(baskets.map(item => item.symbol.toUpperCase()))];
    console.log(`Found active ETF symbols: ${symbols.join(', ')}`);

    const newPrices = { FUSD: 1.00 };
    const querySymbols = symbols.filter(s => s !== 'FUSD');

    // 3. Batch fetch prices from Stooq (for all non-FUSD symbols at once)
    if (querySymbols.length > 0) {
      try {
        console.log(`Performing batch Stooq query for: ${querySymbols.join(', ')}`);
        const stooqParams = querySymbols.map(s => `${s.toLowerCase()}.us`).join('+');
        const url = `https://stooq.com/q/l/?s=${stooqParams}&f=sd2t2ohlcv&h&e=csv`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: AbortSignal.timeout(10000)
        });
        
        if (res.ok) {
          const text = await res.text();
          const lines = text.trim().split('\n');
          if (lines.length >= 2) {
            const headers = lines[0].split(',');
            const symbolIdx = headers.indexOf('Symbol');
            const closeIdx = headers.indexOf('Close');
            
            if (symbolIdx !== -1 && closeIdx !== -1) {
              for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length > Math.max(symbolIdx, closeIdx)) {
                  const stooqSym = parts[symbolIdx].trim().toUpperCase().split('.')[0]; // e.g. "MRVL" from "MRVL.US"
                  const priceStr = parts[closeIdx].trim();
                  if (priceStr !== 'N/D') {
                    const priceNum = parseFloat(priceStr);
                    if (!isNaN(priceNum) && priceNum > 0) {
                      newPrices[stooqSym] = Math.round(priceNum * 100) / 100;
                      console.log(`Batch Resolved ${stooqSym}: $${newPrices[stooqSym]}`);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (stooqErr) {
        console.warn(`Batch Stooq request failed: ${stooqErr.message}`);
      }
    }

    // 4. Clean up / Resolve fallbacks for missing symbols
    for (const symbol of symbols) {
      if (newPrices[symbol] === undefined) {
        console.log(`Resolving fallback for missing symbol: ${symbol}`);
        try {
          newPrices[symbol] = await resolveSinglePrice(symbol, supabase);
          console.log(`Fallback resolved ${symbol}: $${newPrices[symbol]}`);
        } catch (err) {
          console.error(`Could not resolve price for ${symbol} even via fallbacks: ${err.message}`);
          newPrices[symbol] = 0.00;
        }
      }
    }

    // 5. Update the etf_prices table in Supabase
    console.log('Updating etf_prices table...');
    const upsertRows = Object.entries(newPrices).map(([symbol, current_price]) => ({
      symbol,
      current_price,
      last_updated: new Date().toISOString()
    }));

    const { error: upsertError } = await supabase
      .from('etf_prices')
      .upsert(upsertRows, { onConflict: 'symbol' });

    if (upsertError) throw upsertError;

    // 6. Fetch current player portfolios & cash to record daily snapshot
    const { data: players, error: playersError } = await supabase.from('players').select('*');
    if (playersError) throw playersError;

    const { data: allBaskets, error: allBasketsError } = await supabase.from('baskets').select('*');
    if (allBasketsError) throw allBasketsError;

    // Determine current 4-hour snapshot block (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
    const now = new Date();
    const hours = now.getUTCHours();
    const blockHours = Math.floor(hours / 4) * 4;
    const snapshotDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        blockHours,
        0, 0, 0
    ));
    const snapshotTimeISO = snapshotDate.toISOString();

    const historyRows = [];

    console.log('Calculating individual portfolio values...');
    for (const player of players) {
      const playerAssets = allBaskets.filter(item => item.player_id === player.id);
      let stockVal = 0;
      
      for (const asset of playerAssets) {
        const currentPrice = newPrices[asset.symbol.toUpperCase()] || Number(asset.purchase_price);
        stockVal += Number(asset.shares) * currentPrice;
      }

      const portfolioVal = Math.round((Number(player.cash) + stockVal) * 100) / 100;
      
      historyRows.push({
        snapshot_time: snapshotTimeISO,
        player_id: player.id,
        portfolio_value: portfolioVal
      });
      
      console.log(`- ${player.name}: $${portfolioVal}`);
    }

    // Write snapshots to history table
    console.log(`Writing 4-hour history snapshots for ${snapshotTimeISO}...`);
    const { error: historyError } = await supabase
      .from('history')
      .upsert(historyRows, { onConflict: 'snapshot_time,player_id' });

    if (historyError) throw historyError;

    console.log('Update complete!');
    return response.status(200).json({
      success: true,
      message: `Successfully updated ${symbols.length} ETF prices and added historical entries for ${snapshotTimeISO}.`,
      prices: newPrices
    });

  } catch (error) {
    console.error('Error during update process:', error);
    return response.status(500).json({
      success: false,
      error: error.message || 'An error occurred during the update process.'
    });
  }
}
