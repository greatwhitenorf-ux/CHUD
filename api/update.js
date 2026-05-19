// Vercel Serverless Function to update ETF prices and calculate portfolio values
// Scheduled to run Monday - Friday at market close

import { createClient } from '@supabase/supabase-js';

export default async function handler(request, response) {
  // 1. Authenticate the Cron request in production
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get ? request.headers.get('authorization') : request.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // 3. Fetch latest prices from Yahoo Finance
    const newPrices = {};
    for (const symbol of symbols) {
      console.log(`Fetching price for ${symbol}...`);
      let price = null;
      
      // Try up to 3 times
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(10000) // 10s timeout
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
          
          if (price !== null && price !== undefined) {
            break;
          }
        } catch (e) {
          console.warn(`Attempt ${attempt} failed for ${symbol}: ${e.message}`);
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (price !== null) {
        newPrices[symbol] = Math.round(Number(price) * 100) / 100;
        console.log(`Success: ${symbol} = ${newPrices[symbol]}`);
      } else {
        // Fallback to existing price in cache
        const { data: cached } = await supabase
          .from('etf_prices')
          .select('current_price')
          .eq('symbol', symbol)
          .single();

        if (cached) {
          newPrices[symbol] = Number(cached.current_price);
          console.warn(`Failed to fetch ${symbol}, using cached price: ${newPrices[symbol]}`);
        } else {
          newPrices[symbol] = 0.00;
          console.error(`Failed to fetch ${symbol} and no cached price exists!`);
        }
      }
    }

    // 4. Update the etf_prices table in Supabase
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

    // 5. Fetch current player portfolios & cash to record daily snap shot
    const { data: players, error: playersError } = await supabase.from('players').select('*');
    if (playersError) throw playersError;

    const { data: allBaskets, error: allBasketsError } = await supabase.from('baskets').select('*');
    if (allBasketsError) throw allBasketsError;

    const todayStr = new Date().toISOString().split('T')[0];
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
        date: todayStr,
        player_id: player.id,
        portfolio_value: portfolioVal
      });
      
      console.log(`- ${player.name}: $${portfolioVal}`);
    }

    // Write snap shots to history table
    console.log(`Writing daily history snapshots for ${todayStr}...`);
    const { error: historyError } = await supabase
      .from('history')
      .upsert(historyRows, { onConflict: 'date,player_id' });

    if (historyError) throw historyError;

    console.log('Update complete!');
    return response.status(200).json({
      success: true,
      message: `Successfully updated ${symbols.length} ETF prices and added historical entries for ${todayStr}.`,
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
