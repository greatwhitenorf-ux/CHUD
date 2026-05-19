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
    "nate": { border: "hsl(245, 82%, 67%)", bg: "rgba(99, 102, 241, 0.1)" },
    "alice": { border: "hsl(162, 85%, 45%)", bg: "rgba(16, 185, 129, 0.1)" },
    "bob": { border: "hsl(342, 85%, 58%)", bg: "rgba(239, 68, 68, 0.1)" },
    "charlie": { border: "hsl(45, 95%, 50%)", bg: "rgba(245, 158, 11, 0.1)" }
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    initSupabase();
    setupEventListeners();
});

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
        const [playersRes, basketsRes, pricesRes, historyRes] = await Promise.all([
            supabaseClient.from("players").select("*"),
            supabaseClient.from("baskets").select("*"),
            supabaseClient.from("etf_prices").select("*"),
            supabaseClient.from("history").select("*")
        ]);

        if (playersRes.error) throw playersRes.error;
        if (basketsRes.error) throw basketsRes.error;
        if (pricesRes.error) throw pricesRes.error;
        if (historyRes.error) throw historyRes.error;

        const players = playersRes.data;
        const baskets = basketsRes.data;
        const etfPrices = pricesRes.data;
        const history = historyRes.data;

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
            lastUpdated: maxLastUpdated
        };

        renderDashboard();

    } catch (error) {
        console.error("Database query failed:", error);
        document.getElementById("podium").innerHTML = `
            <div class="podium-loading text-danger" style="text-align: center;">
                ⚠️ Database error: ${error.message || error}<br>
                Please verify your tables are seeded in Supabase.
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
            pointBorderColor: "#0d1222"
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
                        color: "#94a3b8",
                        font: { family: "Plus Jakarta Sans", weight: "600", size: 11 },
                        boxWidth: 12,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: "#0d1222",
                    titleColor: "#f8fafc",
                    bodyColor: "#94a3b8",
                    borderColor: "rgba(255, 255, 255, 0.08)",
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.raw >= 0 ? "+" : ""}${context.raw.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.03)" },
                    ticks: {
                        color: "#94a3b8",
                        font: { family: "Plus Jakarta Sans", size: 10 }
                    }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: {
                        color: "#94a3b8",
                        font: { family: "Plus Jakarta Sans", size: 10 },
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
    document.getElementById("drawer-player-name").textContent = player.name + "'s Basket";
    document.getElementById("drawer-portfolio-value").textContent = `$${player.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const returnSign = player.totalReturnPercent >= 0 ? "+" : "";
    const returnEl = document.getElementById("drawer-total-return");
    returnEl.textContent = `${returnSign}${player.totalReturnPercent.toFixed(2)}%`;
    returnEl.className = `stat-value ${player.totalReturnPercent >= 0 ? 'text-success' : 'text-danger'}`;
    
    document.getElementById("drawer-cash-reserve").textContent = `$${player.cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const holdingsContainer = document.getElementById("drawer-holdings");
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
            <div style="font-size: 0.8rem; color: var(--text-secondary);">${ETF_NAMES[item.symbol] || "Exchange-Traded Fund"}</div>
            <div class="holding-details-grid">
                <div class="holding-detail-row">
                    <span class="label" style="color: var(--text-muted)">Cost:</span>
                    <span>$${item.purchasePrice.toFixed(2)}</span>
                </div>
                <div class="holding-detail-row">
                    <span class="label" style="color: var(--text-muted)">Current:</span>
                    <span>$${item.currentPrice.toFixed(2)}</span>
                </div>
                <div class="holding-detail-row" style="grid-column: span 2; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 4px; margin-top: 4px;">
                    <span class="label" style="color: var(--text-muted)">Gain/Loss:</span>
                    <strong class="${textClass}">${retSign}${(itemVal - initialCost).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${retSign}${retPercent.toFixed(2)}%)</strong>
                </div>
            </div>
        `;
        holdingsContainer.appendChild(div);
    });

    document.getElementById("drawer-overlay").classList.add("active");
    document.getElementById("basket-drawer").classList.add("active");
}

function closePlayerDrawer() {
    document.getElementById("drawer-overlay").classList.remove("active");
    document.getElementById("basket-drawer").classList.remove("active");
}

// Setup listeners & pre-fill input values
function setupEventListeners() {
    document.getElementById("close-drawer").addEventListener("click", closePlayerDrawer);
    document.getElementById("drawer-overlay").addEventListener("click", closePlayerDrawer);

    const settingsOverlay = document.getElementById("settings-overlay");
    document.getElementById("open-settings").addEventListener("click", () => {
        settingsOverlay.classList.add("active");
    });
    
    document.getElementById("close-settings").addEventListener("click", () => {
        settingsOverlay.classList.remove("active");
    });
    
    settingsOverlay.addEventListener("click", (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.classList.remove("active");
        }
    });

    // Simulated Pricing buttons (client-side simulation)
    document.getElementById("btn-sync-prices").addEventListener("click", simulatePriceCheck);
    document.getElementById("btn-reset-league").addEventListener("click", resetLeagueData);
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
