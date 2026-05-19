# Simple Local Web Server for Fantasy ETF League
# Runs natively on Windows PowerShell without any external dependencies

$ErrorActionPreference = "Stop"

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = "." }

$Port = 8000
$Url = "http://localhost:$Port/"
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Url)

try {
    $Listener.Start()
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "  🚀 Fantasy ETF League Server is Live!" -ForegroundColor Green
    Write-Host "  🌍 Access the dashboard at: $Url" -ForegroundColor Yellow
    Write-Host "  Press Ctrl+C in this terminal window to stop." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Cyan

    # Try to open the URL in the default browser
    Start-Process $Url

    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response
        
        $LocalPath = $Request.Url.LocalPath
        if ($LocalPath -eq "/") {
            $LocalPath = "/index.html"
        }
        
        # Resolve target file path (strip leading slash)
        $CleanPath = $LocalPath.TrimStart('/')
        $FilePath = Join-Path $ScriptDir $CleanPath
        
        if (Test-Path $FilePath -PathType Leaf) {
            $Bytes = [System.IO.File]::ReadAllBytes($FilePath)
            $Response.ContentLength64 = $Bytes.Length
            
            # Detect MIME types
            if ($FilePath -like "*.html") { $Response.ContentType = "text/html; charset=utf-8" }
            elseif ($FilePath -like "*.css") { $Response.ContentType = "text/css" }
            elseif ($FilePath -like "*.js") { $Response.ContentType = "application/javascript" }
            elseif ($FilePath -like "*.json") { $Response.ContentType = "application/json" }
            elseif ($FilePath -like "*.png") { $Response.ContentType = "image/png" }
            elseif ($FilePath -like "*.jpg" -or $FilePath -like "*.jpeg") { $Response.ContentType = "image/jpeg" }
            
            $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
        } else {
            Write-Host "404 Not Found: $LocalPath" -ForegroundColor DarkYellow
            $Response.StatusCode = 404
        }
        
        $Response.OutputStream.Close()
    }
}
catch {
    Write-Host "Error starting server: $_" -ForegroundColor Red
}
finally {
    if ($Listener.IsListening) {
        $Listener.Stop()
    }
}
