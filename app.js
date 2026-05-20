// Fantasy ETF League - Frontend Client
// Queries Supabase for live player portfolios, price caches, and historical timelines

// --- HARDCODE OPTION ---
// If you want to deploy the dashboard publicly without requiring users to enter keys,
const HARDCODED_SUPABASE_URL = "https://glybaxfjhirnxvcxjchv.supabase.co";
const HARDCODED_SUPABASE_ANON_KEY = "sb_publishable_aOv4t4ergTDSYFvcj_vNEQ_yPk3shs1";
// -----------------------

let leagueData = null;
let chartInstance = null;
let supabaseClient = null;

const ETF_NAMES = {
    "FUSD": "Fantasy USD Placeholder ETF",
    "SPY": "SPDR S&P 500 ETF Trust",
    "QQQ": "Invesco QQQ Trust (Nasdaq 100)",
    "VOO": "Vanguard S&P 500 ETF",
    "GLD": "SPDR Gold Shares",
    "SMH": "VanEck Semiconductor ETF",
    "ARKK": "ARK Innovation ETF",
    "SCHD": "Schwab US Dividend Equity ETF",
    "BND": "Vanguard Total Bond Market ETF"
};

const PLAYER_COLORS = {
    "dan": { border: "#ec4899", bg: "rgba(236, 72, 153, 0.1)" },     // Candy Pink
    "zach": { border: "#22c55e", bg: "rgba(34, 197, 94, 0.1)" },     // Candy Green
    "chris": { border: "#fbbf24", bg: "rgba(251, 191, 36, 0.1)" },    // Candy Yellow
    "nate": { border: "#a855f7", bg: "rgba(168, 85, 247, 0.1)" }     // Candy Purple
};

// Initialize Application
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}

function initializeApp() {
    initSupabase();
    setupEventListeners();
}

// Get Supabase credentials from local storage or hardcoded values
function getSupabaseCredentials() {
    const url = HARDCODED_SUPABASE_URL || localStorage.getItem("SUPABASE_URL") || "";
    const key = HARDCODED_SUPABASE_ANON_KEY || localStorage.getItem("SUPABASE_ANON_KEY") || "";
    return { url, key };
}

// Initialize Supabase Client
function initSupabase() {
    const { url, key } = getSupabaseCredentials();

    if (!url || !key) {
        // Show missing credentials banner in the UI
        document.getElementById("podium").innerHTML = `
            <div class="podium-loading" style="flex-direction: column; text-align: center; gap: 1rem; width: 100%;">
                <span>🔌 Supabase database is not connected yet.</span>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('settings-overlay').classList.add('active')">
                    ⚙️ Open Settings to Connect
                </button>
            </div>
        `;
        document.getElementById("scoreboard-body").innerHTML = `
            <tr>
                <td colspan="6" class="text-center" style="color: var(--text-muted);">
                    Provide your Supabase URL and Anon Key in League Settings to view standings.
                </td>
            </tr>
        `;
        return;
    }

    try {
        const { createClient } = window.supabase;
        supabaseClient = createClient(url, key);
        loadLeagueData();
    } catch (e) {
        console.error("Error creating Supabase client:", e);
        document.getElementById("podium").innerHTML = `
            <div class="podium-loading text-danger">
                ⚠️ Failed to initialize Supabase client. Check console.
            </div>
        `;
    }
}

// Fetch database tables and compile them into dashboard format
async function loadLeagueData() {
    if (!supabaseClient) return;

    try {
        // Query the tables concurrently
        const [playersRes, basketsRes, pricesRes, historyRes, tradesRes] = await Promise.all([
            supabaseClient.from("players").select("*"),
            supabaseClient.from("baskets").select("*"),
            supabaseClient.from("etf_prices").select("*"),
            supabaseClient.from("history").select("*"),
            supabaseClient.from("trades").select("*").order("created_at", { ascending: false }).limit(30)
        ]);

        if (playersRes.error) throw playersRes.error;
        if (basketsRes.error) throw basketsRes.error;
        if (pricesRes.error) throw pricesRes.error;
        if (historyRes.error) throw historyRes.error;

        const players = playersRes.data || [];
        const baskets = basketsRes.data || [];
        const etfPrices = pricesRes.data || [];
        const history = historyRes.data || [];
        
        // Defensively fall back to empty list if trades table doesn't exist yet
        const trades = (tradesRes && !tradesRes.error) ? (tradesRes.data || []) : [];
        if (tradesRes && tradesRes.error) {
            console.warn("Trades table not found or failed to load. Please run schema.sql to initialize it:", tradesRes.error);
        }

        // 1. Map players and nested portfolios
        const playersList = players.map(p => {
            const pBaskets = baskets.filter(b => b.player_id === p.id);
            return {
                id: p.id,
                name: p.name,
                startingCapital: Number(p.starting_capital),
                cash: Number(p.cash),
                basket: pBaskets.map(b => ({
                    symbol: b.symbol.toUpperCase(),
                    shares: Number(b.shares),
                    purchasePrice: Number(b.purchase_price)
                }))
            };
        });

        // 2. Map cached ETF prices
        const etfPricesMap = {};
        let maxLastUpdated = null;
        etfPrices.forEach(e => {
            const sym = e.symbol.toUpperCase();
            etfPricesMap[sym] = Number(e.current_price);
            if (!maxLastUpdated || new Date(e.last_updated) > new Date(maxLastUpdated)) {
                maxLastUpdated = e.last_updated;
            }
        });

        // 3. Group history data points by date for Chart.js
        const historyMap = {};
        history.forEach(h => {
            const dateStr = h.date;
            if (!historyMap[dateStr]) {
                historyMap[dateStr] = { date: dateStr };
            }
            historyMap[dateStr][h.player_id] = Number(h.portfolio_value);
        });
        const historyList = Object.values(historyMap).sort((a, b) => new Date(a.date) - new Date(b.date));

        leagueData = {
            players: playersList,
            etfPrices: etfPricesMap,
            history: historyList,
            trades: trades,
            lastUpdated: maxLastUpdated
        };

        updateTradeAssetDropdown();
        updateTradeCalculator();
        renderDashboard();

        // Asynchronously fetch and refresh actual real-time prices for all assets in players' baskets
        const uniqueSymbols = new Set();
        playersList.forEach(p => {
            p.basket.forEach(item => {
                if (item.symbol) {
                    uniqueSymbols.add(item.symbol.toUpperCase());
                }
            });
        });

        if (uniqueSymbols.size > 0) {
            Promise.all(Array.from(uniqueSymbols).map(sym => resolvePrice(sym)))
                .then(() => {
                    renderDashboard();
                })
                .catch(err => console.error("Error refreshing live prices on load:", err));
        }

    } catch (error) {
        console.error("Database query failed:", error);
        const errMsg = error.message || JSON.stringify(error) || error;

        // Show failure on the podium
        document.getElementById("podium").innerHTML = `
            <div class="podium-loading text-danger" style="text-align: center; font-weight: 700; width: 100%;">
                ⚠️ Connection Failed
            </div>
        `;

        // Show failure on the scoreboard table
        document.getElementById("scoreboard-body").innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger" style="font-weight: 700; padding: 2.5rem; line-height: 1.6;">
                    ⚠️ Database Query Error: ${errMsg}<br>
                    <span style="font-weight: 500; font-size: 0.85rem; color: var(--text-secondary);">
                        Please verify your Supabase database is online, tables are seeded, and credentials are correct.
                    </span>
                </td>
            </tr>
        `;

        // Show failure on the activity feed
        document.getElementById("activity-feed").innerHTML = `
            <div class="text-center text-danger" style="font-weight: 700; padding: 2rem;">
                ⚠️ Could not load activity feed: ${errMsg}
            </div>
        `;
    }
}

// Render all components
function renderDashboard() {
    if (!leagueData) return;

    // 1. Last Updated Time
    const updateTimeEl = document.getElementById("update-time");
    if (leagueData.lastUpdated) {
        const date = new Date(leagueData.lastUpdated);
        updateTimeEl.textContent = date.toLocaleString();
    } else {
        updateTimeEl.textContent = "Never";
    }

    // Calculate live portfolios
    const playersCalculated = leagueData.players.map(player => {
        let stockValue = 0;
        const basketDetails = player.basket.map(item => {
            const currentPrice = leagueData.etfPrices[item.symbol] || item.purchasePrice;
            const itemValue = item.shares * currentPrice;
            const initialCost = item.shares * item.purchasePrice;
            const absoluteReturn = itemValue - initialCost;
            const percentReturn = ((currentPrice - item.purchasePrice) / item.purchasePrice) * 100;
            
            return {
                ...item,
                currentPrice,
                value: itemValue,
                absoluteReturn,
                percentReturn
            };
        });

        const totalValue = player.cash + basketDetails.reduce((sum, item) => sum + item.value, 0);
        const totalReturn = totalValue - player.startingCapital;
        const totalReturnPercent = (totalReturn / player.startingCapital) * 100;

        return {
            ...player,
            basketDetails,
            totalValue,
            totalReturn,
            totalReturnPercent
        };
    });

    // Sort players by performance (descending)
    const sortedPlayers = [...playersCalculated].sort((a, b) => b.totalReturnPercent - a.totalReturnPercent);

    // 2. Render Leaderboard Podium (Top 3)
    renderPodium(sortedPlayers);

    // 3. Render Scoreboard Table
    renderTable(sortedPlayers);

    // 4. Render Chart
    renderChart(playersCalculated);

    // 5. Render Settings Info
    renderSettingsList(playersCalculated);

    // 6. Render Activity Feed
    renderActivityFeed(leagueData.trades);

    // 7. Update Trade Portal player list and price references dynamically
    const tradePlayerSelect = document.getElementById("trade-player-select");
    if (tradePlayerSelect) {
        const currentVal = tradePlayerSelect.value;
        tradePlayerSelect.innerHTML = playersCalculated.map(p => 
            `<option value="${p.id}">${p.name}</option>`
        ).join("");
        if (currentVal && playersCalculated.some(p => p.id === currentVal)) {
            tradePlayerSelect.value = currentVal;
        }
    }
    updateTradeAssetDropdown();
}

// Render Leaderboard Podium
function renderPodium(sortedPlayers) {
    const podiumEl = document.getElementById("podium");
    const p1 = sortedPlayers[0];
    const p2 = sortedPlayers[1];
    const p3 = sortedPlayers[2];

    if (!p1) {
        podiumEl.innerHTML = `<div class="podium-loading">No players found.</div>`;
        return;
    }

    let html = "";
    if (p2) html += createPodiumSpotMarkup(p2, 2);
    else html += `<div class="podium-spot placeholder"></div>`;

    html += createPodiumSpotMarkup(p1, 1);

    if (p3) html += createPodiumSpotMarkup(p3, 3);
    else html += `<div class="podium-spot placeholder"></div>`;

    podiumEl.innerHTML = html;
}

function createPodiumSpotMarkup(player, rank) {
    const returnSign = player.totalReturnPercent >= 0 ? "+" : "";
    const colorClass = player.totalReturnPercent >= 0 ? "text-success" : "text-danger";
    const initial = player.name.charAt(0);
    const colorStyle = PLAYER_COLORS[player.id] || { border: "#6366f1", bg: "rgba(99, 102, 241, 0.1)" };

    return `
        <div class="podium-spot rank-${rank}">
            <div class="podium-avatar" style="background: linear-gradient(135deg, ${colorStyle.border} 0%, #0d1222 100%)">
                ${initial}
            </div>
            <div class="podium-name">${player.name}</div>
            <div class="podium-return ${colorClass}">${returnSign}${player.totalReturnPercent.toFixed(2)}%</div>
            <div class="podium-column">
                <span>${rank}</span>
            </div>
        </div>
    `;
}

// Render detailed portfolios table
function renderTable(sortedPlayers) {
    const tbody = document.getElementById("scoreboard-body");
    tbody.innerHTML = "";

    sortedPlayers.forEach((player, index) => {
        const rank = index + 1;
        const returnSign = player.totalReturnPercent >= 0 ? "+" : "";
        const trendClass = player.totalReturnPercent >= 0 ? "positive" : "negative";
        const colorStyle = PLAYER_COLORS[player.id] || { border: "#6366f1" };
        const initial = player.name.charAt(0);

        const tr = document.createElement("tr");
        tr.dataset.playerId = player.id;
        tr.innerHTML = `
            <td><strong>#${rank}</strong></td>
            <td>
                <div class="player-name-cell">
                    <span class="player-icon" style="background: ${colorStyle.border}">${initial}</span>
                    <span>${player.name}</span>
                </div>
            </td>
            <td><strong>$${player.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
            <td>
                <span class="trend-badge ${trendClass}">
                    ${returnSign}${player.totalReturnPercent.toFixed(2)}%
                </span>
            </td>
            <td>$${player.cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td><button class="btn btn-secondary btn-sm">👁️ View Basket</button></td>
        `;

        tr.addEventListener("click", () => openPlayerDrawer(player));
        tbody.appendChild(tr);
    });
}

// Render historical timeline chart
function renderChart(players) {
    const ctx = document.getElementById("performanceChart").getContext("2d");
    if (!ctx) return;
    
    const sortedHistory = [...leagueData.history].sort((a, b) => new Date(a.date) - new Date(b.date));
    const dates = sortedHistory.map(entry => {
        const d = new Date(entry.date);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    });

    const datasets = players.map(player => {
        const colorConfig = PLAYER_COLORS[player.id] || { border: "#6366f1" };
        
        const dataPoints = sortedHistory.map(entry => {
            const playerVal = entry[player.id] || player.startingCapital;
            return ((playerVal - player.startingCapital) / player.startingCapital) * 100;
        });

        return {
            label: player.name,
            data: dataPoints,
            borderColor: colorConfig.border,
            backgroundColor: "transparent",
            borderWidth: 3,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: colorConfig.border,
            pointBorderColor: "#ffffff"
        };
    });

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        color: "#1e293b",
                        font: { family: "Fredoka", weight: "700", size: 12 },
                        boxWidth: 12,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: "#ffffff",
                    titleColor: "#1e293b",
                    bodyColor: "#475569",
                    borderColor: "#1e293b",
                    borderWidth: 3,
                    titleFont: { family: "Fredoka", weight: "700" },
                    bodyFont: { family: "Fredoka" },
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.raw >= 0 ? "+" : ""}${context.raw.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(30, 41, 59, 0.08)" },
                    ticks: {
                        color: "#1e293b",
                        font: { family: "Fredoka", size: 11, weight: "600" }
                    }
                },
                y: {
                    grid: { color: "rgba(30, 41, 59, 0.08)" },
                    ticks: {
                        color: "#1e293b",
                        font: { family: "Fredoka", size: 11, weight: "600" },
                        callback: function(value) {
                            return (value >= 0 ? "+" : "") + value.toFixed(1) + "%";
                        }
                    }
                }
            }
        }
    });
}

// Open Drawer for Player basket details
function openPlayerDrawer(player) {
    const setElText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setElText("drawer-player-name", player.name + "'s Basket");
    setElText("drawer-portfolio-value", `$${player.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    
    const returnSign = player.totalReturnPercent >= 0 ? "+" : "";
    const returnEl = document.getElementById("drawer-total-return");
    if (returnEl) {
        returnEl.textContent = `${returnSign}${player.totalReturnPercent.toFixed(2)}%`;
        returnEl.className = `stat-value ${player.totalReturnPercent >= 0 ? 'text-success' : 'text-danger'}`;
    }
    
    setElText("drawer-cash-reserve", `$${player.cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    const holdingsContainer = document.getElementById("drawer-holdings");
    if (holdingsContainer) {
        holdingsContainer.innerHTML = "";

        player.basketDetails.forEach(item => {
            const itemVal = item.shares * item.currentPrice;
            const initialCost = item.shares * item.purchasePrice;
            const retPercent = ((item.currentPrice - item.purchasePrice) / item.purchasePrice) * 100;
            const retSign = retPercent >= 0 ? "+" : "";
            const textClass = retPercent >= 0 ? "text-success" : "text-danger";

            const div = document.createElement("div");
            div.className = "holding-item";
            div.innerHTML = `
                <div class="holding-header">
                    <div>
                        <span class="holding-sym">${item.symbol}</span>
                        <span class="holding-qty">(${item.shares} shares)</span>
                    </div>
                    <div class="holding-val-main">$${itemVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem;">${ETF_NAMES[item.symbol] || "Exchange-Traded Fund"}</div>
                <div class="holding-details-grid">
                    <div class="holding-detail-row">
                        <span class="label" style="color: var(--text-muted)">Cost:</span>
                        <span>$${item.purchasePrice.toFixed(2)}</span>
                    </div>
                    <div class="holding-detail-row">
                        <span class="label" style="color: var(--text-muted)">Current:</span>
                        <span>$${item.currentPrice.toFixed(2)}</span>
                    </div>
                    <div class="holding-detail-row" style="grid-column: span 2; border-top: 2px dashed var(--border-color); padding-top: 6px; margin-top: 6px;">
                        <span class="label" style="color: var(--text-muted)">Gain/Loss:</span>
                        <strong class="${textClass}">${retSign}${(itemVal - initialCost).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${retSign}${retPercent.toFixed(2)}%)</strong>
                    </div>
                </div>
            `;
            holdingsContainer.appendChild(div);
        });
    }

    const drawerOverlay = document.getElementById("drawer-overlay");
    const drawer = document.getElementById("player-drawer") || document.getElementById("basket-drawer");
    if (drawerOverlay) drawerOverlay.classList.add("active");
    if (drawer) drawer.classList.add("active");
}

function closePlayerDrawer() {
    const drawerOverlay = document.getElementById("drawer-overlay");
    const drawer = document.getElementById("player-drawer") || document.getElementById("basket-drawer");
    if (drawerOverlay) drawerOverlay.classList.remove("active");
    if (drawer) drawer.classList.remove("active");
}

// Setup listeners & pre-fill input values
function setupEventListeners() {
    const addListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    };

    addListener("close-drawer", "click", closePlayerDrawer);
    addListener("drawer-overlay", "click", closePlayerDrawer);

    const settingsOverlay = document.getElementById("settings-overlay");
    if (settingsOverlay) {
        addListener("open-settings", "click", () => {
            settingsOverlay.classList.add("active");
        });
        addListener("close-settings", "click", () => {
            settingsOverlay.classList.remove("active");
        });
        settingsOverlay.addEventListener("click", (e) => {
            if (e.target === settingsOverlay) {
                settingsOverlay.classList.remove("active");
            }
        });
    }

    const tradeOverlay = document.getElementById("trade-overlay");
    if (tradeOverlay) {
        addListener("open-trade", "click", () => {
            tradeOverlay.classList.add("active");
            updateTradeCalculator();
        });
        addListener("close-trade-modal", "click", () => {
            tradeOverlay.classList.remove("active");
        });
        tradeOverlay.addEventListener("click", (e) => {
            if (e.target === tradeOverlay) {
                tradeOverlay.classList.remove("active");
            }
        });
    }

    addListener("trade-player-select", "change", updateTradeCalculator);
    addListener("trade-action-select", "change", updateTradeCalculator);
    addListener("trade-asset-input", "input", updateTradeCalculator);
    addListener("trade-shares-input", "input", updateTradeCalculator);

    addListener("btn-submit-trade", "click", executeTrade);
    addListener("btn-sync-prices", "click", simulatePriceCheck);
    addListener("btn-reset-league", "click", resetLeagueData);
}

// Render lists of assets inside the settings tab
function renderSettingsList(players) {
    const container = document.getElementById("settings-player-list");
    container.innerHTML = "";

    players.forEach(player => {
        const etfsList = player.basket.map(a => `${a.shares} ${a.symbol}`).join(", ");
        const div = document.createElement("div");
        div.className = "player-setting-row";
        div.innerHTML = `
            <div>
                <div class="player-setting-info">${player.name}</div>
                <div class="player-setting-etfs">${etfsList}</div>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">$${player.cash.toLocaleString()} cash</div>
        `;
        container.appendChild(div);
    });
}

// Local simulation of price updates (stored in browser memory, doesn't write to Supabase since Anon Key has read-only RLS)
function simulatePriceCheck() {
    if (!leagueData) return;

    alert("Simulating local price fluctuations in-browser memory... (Note: These client-side changes will not write to Supabase. Run your Vercel serverless function or cron to update the live database permanently.)");

    const newPrices = { ...leagueData.etfPrices };
    for (const sym in newPrices) {
        const changePct = (Math.random() * 4.0 - 1.8) / 100; // -1.8% to +2.2%
        newPrices[sym] = Math.max(1.0, Math.round(newPrices[sym] * (1 + changePct) * 100) / 100);
    }
    
    let nextDateStr = "";
    if (leagueData.history.length > 0) {
        const lastEntry = leagueData.history[leagueData.history.length - 1];
        const lastDate = new Date(lastEntry.date);
        const nextDate = new Date(lastDate);
        nextDate.setDate(lastDate.getDate() + 1);
        
        if (nextDate.getDay() === 6) nextDate.setDate(nextDate.getDate() + 2);
        else if (nextDate.getDay() === 0) nextDate.setDate(nextDate.getDate() + 1);
        
        nextDateStr = nextDate.toISOString().split("T")[0];
    } else {
        nextDateStr = new Date().toISOString().split("T")[0];
    }

    const newHistoryEntry = { date: nextDateStr };
    leagueData.players.forEach(player => {
        let stockVal = 0;
        player.basket.forEach(asset => {
            stockVal += asset.shares * newPrices[asset.symbol];
        });
        newHistoryEntry[player.id] = Math.round((player.cash + stockVal) * 100) / 100;
    });

    leagueData.etfPrices = newPrices;
    leagueData.history.push(newHistoryEntry);
    leagueData.lastUpdated = new Date().toISOString();

    renderDashboard();
}

// Reset league scores locally by reloading from database
async function resetLeagueData() {
    if (confirm("Reset current screen values? This will discard browser simulation changes and reload the latest official database records from Supabase.")) {
        await loadLeagueData();
        alert("Dashboard reset to match Supabase database values!");
    }
}

// Simple hash-based mock price generator for standard/unsupported assets when backend is offline
function getMockPrice(symbol) {
    const clean = symbol.trim().toUpperCase();
    if (clean === "FUSD") return 1.00;
    
    // Hash the symbol name to get a consistent pseudo-random price between $10 and $500
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
        hash = clean.charCodeAt(i) + ((hash << 5) - hash);
    }
    const seed = Math.abs(hash);
    const price = 10 + (seed % 490) + (seed % 100) / 100;
    return Math.round(price * 100) / 100;
}

// Resolve the price of a ticker symbol.
// If it's cached locally, returns it. Otherwise, calls /api/price or falls back to Yahoo Finance via CORS proxy.
let priceLookupTimeout = null;
async function resolvePrice(symbol) {
    if (!symbol) return 0;
    const cleanSymbol = symbol.trim().toUpperCase();
    if (cleanSymbol === "FUSD") return 1.00;

    // Check local cache
    if (leagueData && leagueData.etfPrices && leagueData.etfPrices[cleanSymbol]) {
        return Number(leagueData.etfPrices[cleanSymbol]);
    }

    // 1. Try Vercel Serverless Backend API first
    try {
        const response = await fetch(`/api/price?symbol=${cleanSymbol}`);
        if (response.ok) {
            const data = await response.json();
            if (data && data.price) {
                if (!leagueData.etfPrices) leagueData.etfPrices = {};
                leagueData.etfPrices[cleanSymbol] = data.price;
                
                if (!ETF_NAMES[cleanSymbol]) {
                    ETF_NAMES[cleanSymbol] = `${cleanSymbol} Stock / ETF`;
                }

                updateTradeAssetDropdown();
                return data.price;
            }
        }
    } catch (e) {
        console.warn("Local backend API offline, attempting direct CORS proxy fetch...");
    }

    // 2. Fall back to direct Yahoo Finance fetch via a public CORS proxy (useful for local dev/testing)
    try {
        const url = `https://api.allorigins.win/raw?url=https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?range=1d&interval=1d`;
        const res = await fetch(url);
        if (res.ok) {
            const json = await res.json();
            const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (price !== undefined && price !== null) {
                const priceNum = Math.round(Number(price) * 100) / 100;
                if (!leagueData.etfPrices) leagueData.etfPrices = {};
                leagueData.etfPrices[cleanSymbol] = priceNum;
                
                if (!ETF_NAMES[cleanSymbol]) {
                    ETF_NAMES[cleanSymbol] = `${cleanSymbol} Stock / ETF`;
                }

                updateTradeAssetDropdown();
                return priceNum;
            }
        }
    } catch (e) {
        console.warn("Direct CORS proxy fetch failed for:", cleanSymbol, e);
    }

    // 3. Last resort fallback to a mock generator if both are offline
    const fallbackPrice = getMockPrice(cleanSymbol);
    if (!leagueData.etfPrices) leagueData.etfPrices = {};
    leagueData.etfPrices[cleanSymbol] = fallbackPrice;
    
    if (!ETF_NAMES[cleanSymbol]) {
        ETF_NAMES[cleanSymbol] = `${cleanSymbol} Stock / ETF`;
    }
    
    updateTradeAssetDropdown();
    return fallbackPrice;
}

// Update the pricing reference list in the trade portal modal
function updateTradeAssetDropdown() {
    const refContainer = document.getElementById("trade-price-reference");
    if (!refContainer || !leagueData) return;

    let html = "";
    // Show FUSD first
    html += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem; background: #fff; border: 2px solid var(--border-color); border-radius: 8px; font-size: 0.8rem;">
            <span style="font-weight: 800;">💵 FUSD (Fantasy USD)</span>
            <strong style="color: var(--success); font-family: monospace;">$1.00</strong>
        </div>
    `;

    // Show other active etf prices in database
    Object.entries(leagueData.etfPrices || {}).forEach(([symbol, price]) => {
        if (symbol === "FUSD") return;
        const name = ETF_NAMES[symbol] || "Stock / ETF";
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem; background: #fff; border: 2px solid var(--border-color); border-radius: 8px; font-size: 0.8rem;">
                <span style="font-weight: 800;">🚀 ${symbol} (${name.split(" (")[0]})</span>
                <strong style="color: var(--text-primary); font-family: monospace;">$${price.toFixed(2)}</strong>
            </div>
        `;
    });

    refContainer.innerHTML = html;
}

// Live calculation preview of the trade
async function updateTradeCalculator() {
    if (!leagueData) return;

    const playerId = document.getElementById("trade-player-select").value;
    const action = document.getElementById("trade-action-select").value;
    const symbolInput = document.getElementById("trade-asset-input");
    if (!symbolInput) return;
    const symbol = symbolInput.value.trim().toUpperCase();
    const qty = parseFloat(document.getElementById("trade-shares-input").value) || 0;

    const player = leagueData.players.find(p => p.id === playerId);
    if (!player) return;

    // Show feedback if price is loading/unsupported
    const estCostEl = document.getElementById("trade-est-cost");
    const cashRemEl = document.getElementById("trade-cash-rem");
    
    let price = 0;
    if (symbol !== "") {
        if (leagueData.etfPrices && leagueData.etfPrices[symbol]) {
            price = Number(leagueData.etfPrices[symbol]);
        } else if (symbol === "FUSD") {
            price = 1.00;
        } else {
            if (estCostEl) {
                estCostEl.textContent = "🔍 Fetching price...";
                estCostEl.style.color = "var(--text-muted)";
            }
            // Debounce the remote fetch request to avoid flooding Yahoo Finance
            clearTimeout(priceLookupTimeout);
            priceLookupTimeout = setTimeout(async () => {
                const resolved = await resolvePrice(symbol);
                if (resolved > 0) {
                    updateTradeCalculator(); // Re-calculate with new price
                } else {
                    if (estCostEl) {
                        estCostEl.textContent = "⚠️ Price unavailable";
                        estCostEl.style.color = "var(--danger)";
                    }
                }
            }, 500);
            return;
        }
    }

    const estValue = qty * price;
    
    let remCash = player.cash;
    if (action === "buy") {
        remCash = player.cash - estValue;
    } else {
        remCash = player.cash + estValue;
    }

    const cashAvailEl = document.getElementById("trade-cash-avail");
    if (cashAvailEl) cashAvailEl.textContent = `$${player.cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    if (estCostEl) {
        estCostEl.textContent = `$${estValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ($${price.toFixed(2)}/sh)`;
        estCostEl.style.color = "var(--text-primary)";
    }
    
    if (cashRemEl) {
        cashRemEl.textContent = `$${remCash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (remCash < 0) {
            cashRemEl.style.color = "var(--danger)";
        } else {
            cashRemEl.style.color = "var(--success)";
        }
    }
}

// Execute buy/sell in Supabase using JavaScript SDK
async function executeTrade() {
    if (!supabaseClient) {
        alert("Supabase is not connected!");
        return;
    }

    const playerId = document.getElementById("trade-player-select").value;
    const action = document.getElementById("trade-action-select").value;
    const symbol = document.getElementById("trade-asset-input").value.trim().toUpperCase();
    const qty = parseFloat(document.getElementById("trade-shares-input").value);
    const pin = document.getElementById("trade-pin-input").value.trim();

    if (isNaN(qty) || qty <= 0) {
        alert("Please enter a valid quantity greater than 0.");
        return;
    }

    if (pin.length !== 4) {
        alert("Please enter your 4-digit security PIN.");
        return;
    }

    const submitBtn = document.getElementById("btn-submit-trade");
    submitBtn.disabled = true;
    submitBtn.textContent = "⌛ Executing Trade...";

    try {
        // 1. Fetch player PIN & current cash from Supabase to verify authorization
        const { data: playerDb, error: playerError } = await supabaseClient
            .from("players")
            .select("pin, cash")
            .eq("id", playerId)
            .single();

        if (playerError || !playerDb) {
            throw new Error("Could not verify player. Please check connection.");
        }

        if (playerDb.pin !== pin) {
            alert("❌ Invalid Player PIN! Trade rejected.");
            submitBtn.disabled = false;
            submitBtn.textContent = "🚀 Confirm Trade";
            return;
        }

        const price = await resolvePrice(symbol);
        if (price === 0) {
            throw new Error(`Price for "${symbol}" is currently unavailable. Please verify the ticker symbol.`);
        }

        const totalValue = qty * price;
        const currentCash = Number(playerDb.cash);

        if (action === "buy") {
            // Check cash
            if (currentCash < totalValue) {
                alert(`❌ Insufficient cash! You need $${totalValue.toFixed(2)} but only have $${currentCash.toFixed(2)}.`);
                submitBtn.disabled = false;
                submitBtn.textContent = "🚀 Confirm Trade";
                return;
            }

            // Deduct Cash
            const newCash = currentCash - totalValue;
            const { error: cashErr } = await supabaseClient
                .from("players")
                .update({ cash: newCash })
                .eq("id", playerId);

            if (cashErr) throw cashErr;

            // Check if they already own this symbol
            const { data: existingBasket, error: basketFetchErr } = await supabaseClient
                .from("baskets")
                .select("*")
                .eq("player_id", playerId)
                .eq("symbol", symbol)
                .maybeSingle();

            if (basketFetchErr) throw basketFetchErr;

            if (existingBasket) {
                // Update existing holding shares
                const newShares = Number(existingBasket.shares) + qty;
                const { error: updateErr } = await supabaseClient
                    .from("baskets")
                    .update({ shares: newShares, purchase_price: price }) // Update cost basis to current purchase price
                    .eq("id", existingBasket.id);

                if (updateErr) throw updateErr;
            } else {
                // Insert new holding
                const { error: insertErr } = await supabaseClient
                    .from("baskets")
                    .insert({
                        player_id: playerId,
                        symbol: symbol,
                        shares: qty,
                        purchase_price: price
                    });

                if (insertErr) throw insertErr;
            }

        } else if (action === "sell") {
            // Check if player owns enough shares
            const { data: existingBasket, error: basketFetchErr } = await supabaseClient
                .from("baskets")
                .select("*")
                .eq("player_id", playerId)
                .eq("symbol", symbol)
                .maybeSingle();

            if (basketFetchErr) throw basketFetchErr;

            if (!existingBasket || Number(existingBasket.shares) < qty) {
                const owned = existingBasket ? Number(existingBasket.shares) : 0;
                alert(`❌ Insufficient shares! You want to sell ${qty} shares of ${symbol} but only own ${owned.toFixed(4)} shares.`);
                submitBtn.disabled = false;
                submitBtn.textContent = "🚀 Confirm Trade";
                return;
            }

            // Add Cash
            const newCash = currentCash + totalValue;
            const { error: cashErr } = await supabaseClient
                .from("players")
                .update({ cash: newCash })
                .eq("id", playerId);

            if (cashErr) throw cashErr;

            const remainingShares = Number(existingBasket.shares) - qty;

            if (remainingShares <= 0.0001) {
                // Sell off everything, delete row
                const { error: deleteErr } = await supabaseClient
                    .from("baskets")
                    .delete()
                    .eq("id", existingBasket.id);

                if (deleteErr) throw deleteErr;
            } else {
                // Reduce shares
                const { error: updateErr } = await supabaseClient
                    .from("baskets")
                    .update({ shares: remainingShares })
                    .eq("id", existingBasket.id);

                if (updateErr) throw updateErr;
            }
        } // Close else if (action === "sell")

        // Log the transaction in the trades table
        const { error: logErr } = await supabaseClient
            .from("trades")
            .insert({
                player_id: playerId,
                action: action.toUpperCase(),
                symbol: symbol,
                shares: qty,
                price: price
            });

        if (logErr) console.error("Could not log trade in database:", logErr);

        alert("🎉 Trade executed successfully and leaderboard updated!");
        
        // Reset modal inputs
        document.getElementById("trade-shares-input").value = "";
        document.getElementById("trade-pin-input").value = "";
        document.getElementById("trade-overlay").classList.remove("active");

        // Reload data
        await loadLeagueData();

    } catch (e) {
        console.error("Trade failed:", e);
        alert(`❌ Trade failed: ${e.message || e}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "🚀 Confirm Trade";
    }
}

// Render the activity feed of recent trades below portfolios
function renderActivityFeed(trades) {
    const feedContainer = document.getElementById("activity-feed");
    if (!feedContainer) return;

    if (!trades || trades.length === 0) {
        feedContainer.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">
                No recent trades logged yet.
            </div>
        `;
        return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
    
    trades.forEach(trade => {
        const playerObj = leagueData.players.find(p => p.id === trade.player_id);
        const name = playerObj ? playerObj.name : trade.player_id;
        
        const actionText = trade.action === "BUY" ? "bought" : "sold";
        const actionClass = trade.action === "BUY" ? "text-success" : "text-danger";
        const timeAgo = formatTimeAgo(trade.created_at);
        const sharesFormatted = parseFloat(Number(trade.shares).toFixed(4));
        
        const playerColor = PLAYER_COLORS[trade.player_id] || { border: "#6366f1" };

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; border-radius: 8px; padding: 0.75rem 1rem; border-left: 4px solid ${playerColor.border}; margin-bottom: 0.5rem; background: var(--bg-main); border: 3px solid var(--border-color);">
                <div style="font-size: 0.9rem; color: var(--text-primary); font-weight: 600;">
                    <strong style="color: ${playerColor.border}; font-weight: 800;">${name}</strong>
                    <span style="color: var(--text-secondary); font-weight: 500;"> ${actionText} </span>
                    <strong class="${actionClass}">${sharesFormatted.toLocaleString()}</strong> 
                    <span style="color: var(--text-secondary); font-weight: 500;">shares of</span> 
                    <strong style="color: var(--text-primary);">${trade.symbol}</strong> 
                    <span style="color: var(--text-secondary); font-weight: 500;">@ $${Number(trade.price).toFixed(2)}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); min-width: 90px; text-align: right; font-weight: 600;">
                    🕒 ${timeAgo}
                </div>
            </div>
        `;
    });

    html += '</div>';
    feedContainer.innerHTML = html;
}

// Format date timestamp into readable human format
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "just now";
    if (diffMins === 1) return "1 minute ago";
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return "1 hour ago";
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "yesterday";
    return `${diffDays} days ago`;
}
