# ==============================================================================
# BingX Order Scheduler Backend - Automated SSL Certificate Setup (Windows Server)
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   BingX Order Scheduler Backend - Windows SSL Setup Script" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "❌ Error: Please run PowerShell as Administrator to configure SSL & Win-ACME!" -ForegroundColor Red
    exit 1
}

$domain = Read-Host "Enter your Domain Name or Subdomain (e.g. api.yourdomain.com)"
$email = Read-Host "Enter your Email Address (for Let's Encrypt SSL registration)"
$port = Read-Host "Enter local Node.js Backend Port [Default: 8445]"
if (-not $port) { $port = "8445" }

if (-not $domain -or -not $email) {
    Write-Host "❌ Error: Domain Name and Email Address are required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "⚙️ Configuration Summary:" -ForegroundColor Yellow
Write-Host "   - Domain: $domain" -ForegroundColor Yellow
Write-Host "   - Email: $email" -ForegroundColor Yellow
Write-Host "   - Backend Port: $port" -ForegroundColor Yellow
Write-Host ""

# Download Win-ACME (Let's Encrypt Client for Windows)
$winAcmeZip = "$env:TEMP\win-acme.zip"
$winAcmeDir = "C:\win-acme"

if (-not (Test-Path "$winAcmeDir\wacs.exe")) {
    Write-Host "📦 Downloading Win-ACME (Let's Encrypt for Windows)..." -ForegroundColor Green
    New-Item -ItemType Directory -Force -Path $winAcmeDir | Out-Null
    Invoke-WebRequest -Uri "https://github.com/win-acme/win-acme/releases/download/v2.2.9.1701/win-acme.v2.2.9.1701.x64.pluggable.zip" -OutFile $winAcmeZip
    Expand-Archive -Path $winAcmeZip -DestinationPath $winAcmeDir -Force
    Remove-Item $winAcmeZip -Force
}

Write-Host "🔐 Requesting free Let's Encrypt SSL certificate for $domain..." -ForegroundColor Green

# Execute Win-ACME standalone / manual plugin
& "$winAcmeDir\wacs.exe" --target manual --host $domain --emailaddress $email --accepttos

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🎉 Win-ACME SSL Certificate Script setup completed!" -ForegroundColor Green
Write-Host "   - Domain: https://$domain" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
