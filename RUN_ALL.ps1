# RUN_ALL.ps1 - One script to set up everything

Write-Host "`n===================================" -ForegroundColor Green
Write-Host "HOSPARENT COMPLETE SYSTEM SETUP" -ForegroundColor Green
Write-Host "===================================`n" -ForegroundColor Green

# 1. Pull latest from GitHub
Write-Host "[1] Pulling latest code from GitHub..." -ForegroundColor Cyan
git fetch origin
git reset --hard origin/claude/baylor-price-discrepancy-scbllh
Write-Host "    - Code updated`n" -ForegroundColor Green

# 2. Create all tables and verify database
Write-Host "[2] Setting up database tables..." -ForegroundColor Cyan
node setup_all.js
if ($LASTEXITCODE -ne 0) {
  Write-Host "    ERROR: Setup failed" -ForegroundColor Red
  exit 1
}
Write-Host ""

# 3. Run Hoser to unflag prices
Write-Host "[3] Running Hoser to unflag hidden prices..." -ForegroundColor Cyan
Write-Host "    (This recovers ~20K+ prices within bounds)`n" -ForegroundColor Yellow

node hoser_unflag.js

Write-Host ""

# 4. Test pre-reg coordinator
Write-Host "[4] Testing Pre-Reg Coordinator..." -ForegroundColor Cyan
node prereg_agent.js "Check Dallas for new pricing data and opportunities"
Write-Host ""

# 5. Show summary
Write-Host "===================================" -ForegroundColor Green
Write-Host "COMPLETE SETUP FINISHED!" -ForegroundColor Green
Write-Host "===================================`n" -ForegroundColor Green

Write-Host "Your System is Ready:" -ForegroundColor Yellow
Write-Host "  - Hoser (Advisor) - Ready to answer questions (Opus: 0.15/query)"
Write-Host "  - Pre-Reg Coordinator - Ready to email (Haiku: 0.005/check)"
Write-Host "  - Cost: ~18.60/month total`n" -ForegroundColor Yellow

Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Start server: npm start"
Write-Host "  2. Ask Hoser: 'Why is Hospital X missing?'"
Write-Host "  3. Users pre-register for emails"
Write-Host "  4. Auto-alerts when new data arrives`n" -ForegroundColor Cyan
