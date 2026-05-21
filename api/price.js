// Vercel Serverless Function to fetch Yahoo Finance stock/ETF prices in real-time
// Automatically caches new symbols in the etf_prices table

import { createClient } from '@supabase/supabase-js';

// Multi-stage price resolver
async function resolvePriceWithFallbacks(symbol) {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol === 'FUSD') return 1.00;

  // Stage 1: Try Stooq CSV API (very fast, no auth, no IP bans)
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
                console.log(`Resolved ${cleanSymbol} from Stooq: $${price}`);
                return Math.round(price * 100) / 100;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Stooq lookup failed for ${cleanSymbol}: ${err.message}`);
  }

  // Stage 2: Try direct Yahoo Finance chart API
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
          console.log(`Resolved ${cleanSymbol} from Yahoo Direct: $${priceNum}`);
          return Math.round(priceNum * 100) / 100;
        }
      }
    }
  } catch (err) {
    console.warn(`Yahoo Direct lookup failed for ${cleanSymbol}: ${err.message}`);
  }

  // Stage 3: Try Yahoo Finance via AllOrigins proxy
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
          console.log(`Resolved ${cleanSymbol} from AllOrigins Proxy: $${priceNum}`);
          return Math.round(priceNum * 100) / 100;
        }
      }
    }
  } catch (err) {
    console.warn(`AllOrigins Proxy lookup failed for ${cleanSymbol}: ${err.message}`);
  }

  throw new Error(`Failed to resolve price for symbol "${cleanSymbol}" via all methods.`);
}

export default async function handler(request, response) {
  const { symbol } = request.query;
  if (!symbol) {
    return response.status(400).json({ error: 'Missing symbol parameter' });
  }

  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const priceNum = await resolvePriceWithFallbacks(cleanSymbol);

    // Connect to Supabase using Service Key (bypass RLS write permissions)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase
        .from('etf_prices')
        .upsert({ 
          symbol: cleanSymbol, 
          current_price: priceNum, 
          last_updated: new Date().toISOString() 
        }, { onConflict: 'symbol' });
    }

    return response.status(200).json({
      symbol: cleanSymbol,
      price: priceNum
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
