# Daily Price Fetcher for Fantasy ETF League
# Runs in PowerShell Core (cross-platform, works on Windows and GitHub runners)

$ErrorActionPreference = "Stop"

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = "." }
$DataPath = Join-Path $ScriptDir "data.json"

Write-Host "Loading data from $DataPath..."
if (-not (Test-Path $DataPath)) {
    Write-Error "Could not find data.json at $DataPath"
    exit 1
}

# Load and parse JSON
$DataContent = Get-Content -Raw -Path $DataPath
$Data = ConvertFrom-Json -InputObject $DataContent

# Extract unique ETF symbols
$Symbols = @()
foreach ($Player in $Data.players) {
    foreach ($Asset in $Player.basket) {
        if ($Asset.symbol -and ($Symbols -notcontains $Asset.symbol)) {
            $Symbols += $Asset.symbol
        }
    }
}

Write-Host "Found ETF symbols: $($Symbols -join ', ')"

# Fetch latest closing price for each ETF
$NewPrices = [ordered]@{}
foreach ($Sym in $Symbols) {
    Write-Host "Fetching price for $Sym..."
    $Success = $false
    $Price = 0.00
    
    # Try fetching up to 3 times
    for ($i = 1; $i -le 3; $i++) {
        try {
            $Url = "https://query1.finance.yahoo.com/v8/finance/chart/$($Sym)?range=1d&interval=1d"
            $Headers = @{
                "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            $Response = Invoke-RestMethod -Uri $Url -Headers $Headers -Method Get -TimeoutSec 10
            $Price = $Response.chart.result[0].meta.regularMarketPrice
            if ($null -ne $Price) {
                $Success = $true
                break
            }
        } catch {
            Write-Warning "Attempt $i failed for $Sym. Error: $_"
            Start-Sleep -Seconds 2
        }
    }
    
    if ($Success) {
        $NewPrices[$Sym] = [math]::Round([double]$Price, 2)
        Write-Host "Success: $Sym = $($NewPrices[$Sym])"
    } else {
        # Fallback to existing price in database if available
        if ($Data.etfPrices -and $Data.etfPrices.$Sym) {
            $NewPrices[$Sym] = [double]$Data.etfPrices.$Sym
            Write-Warning "Failed to fetch $Sym. Using cached price: $($NewPrices[$Sym])"
        } else {
            $NewPrices[$Sym] = 0.00
            Write-Error "Failed to fetch $Sym and no cached price exists!"
        }
    }
}

# Update etfPrices cache
$Data.etfPrices = $NewPrices

# Get today's date in YYYY-MM-DD
$TodayStr = Get-Date -Format "yyyy-MM-dd"

# Calculate current value for each player
$HistoryEntry = [ordered]@{
    "date" = $TodayStr
}

Write-Host "`nCalculating current portfolio values:"
foreach ($Player in $Data.players) {
    $TotalStockVal = 0.00
    foreach ($Asset in $Player.basket) {
        $CurrentPrice = $NewPrices[$Asset.symbol]
        $TotalStockVal += ([double]$Asset.shares * [double]$CurrentPrice)
    }
    $CurrentValue = [double]$Player.cash + $TotalStockVal
    $CurrentValueRounded = [math]::Round($CurrentValue, 2)
    $HistoryEntry[$Player.id] = $CurrentValueRounded
    
    $PercentChange = (($CurrentValueRounded - $Player.startingCapital) / $Player.startingCapital) * 100
    Write-Host "- $($Player.name): `$($CurrentValueRounded.ToString('N2')) (Return: $($PercentChange.ToString('F2'))%)"
}

# Update or insert into history
$UpdatedHistory = @()
$Replaced = $false
foreach ($Item in $Data.history) {
    if ($Item.date -eq $TodayStr) {
        # Overwrite today's run if it already exists
        $UpdatedHistory += [PSCustomObject]$HistoryEntry
        $Replaced = $true
        Write-Host "`nUpdated existing history record for $TodayStr"
    } else {
        $UpdatedHistory += $Item
    }
}

if (-not $Replaced) {
    $UpdatedHistory += [PSCustomObject]$HistoryEntry
    Write-Host "`nAppended new history record for $TodayStr"
}

$Data.history = $UpdatedHistory
$Data.lastUpdated = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")

# Convert back to JSON with proper depth and write to file
$JsonString = ConvertTo-Json -InputObject $Data -Depth 100
$JsonString | Out-File -FilePath $DataPath -Encoding utf8 -NoNewline

Write-Host "Saved data.json successfully!"
