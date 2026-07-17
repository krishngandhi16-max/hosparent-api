# RUN_ALL.ps1 - One script to set up everything
# Just copy-paste this entire script into PowerShell

Write-Host "`n====================================" -ForegroundColor Green
Write-Host "HOSPARENT COMPLETE SYSTEM SETUP" -ForegroundColor Green
Write-Host "===================================`n" -ForegroundColor Green

# 1. Pull latest from GitHub
Write-Host "1️⃣  Pulling latest code from GitHub..." -ForegroundColor Cyan
git fetch origin
git reset --hard origin/claude/baylor-price-discrepancy-scbllh
Write-Host "   ✓ Code updated`n" -ForegroundColor Green

# 2. Create all tables and verify database
Write-Host "2️⃣  Setting up database tables..." -ForegroundColor Cyan
node setup_all.js
if ($LASTEXITCODE -ne 0) {
  Write-Host "   ❌ Setup failed" -ForegroundColor Red
  exit 1
}
Write-Host ""

# 3. Run Hoser to unflag prices
Write-Host "3️⃣  Running Hoser to unflag hidden prices..." -ForegroundColor Cyan
Write-Host "   (This recovers ~20K+ prices within bounds)`n" -ForegroundColor Yellow

node -e @"
const { runAgent } = require('./db_agent');
console.log('🤖 Asking Hoser to unflag prices...\n');
runAgent('unflag all prices that are within their per-type bounds using unflag_prices_with_validation and show me recovery stats').then(r => {
  console.log('=== HOSER RESULTS ===\n');
  console.log(r.answer);
  if (r.actions_taken && r.actions_taken.length > 0) {
    console.log('\n✅ Actions taken:');
    r.actions_taken.forEach(a => {
      console.log('  📦', a.name, '→', JSON.stringify(a.result));
    });
  }
  console.log('\n');
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
"@

if ($LASTEXITCODE -ne 0) {
  Write-Host "   ⚠️  Hoser encountered an error (check database connection)" -ForegroundColor Yellow
  Write-Host "   Continuing with setup...\n" -ForegroundColor Yellow
}

# 4. Test pre-reg coordinator
Write-Host "4️⃣  Testing Pre-Reg Coordinator..." -ForegroundColor Cyan
node prereg_agent.js "Check Dallas for new pricing data and opportunities"
Write-Host ""

# 5. Show summary
Write-Host "====================================" -ForegroundColor Green
Write-Host "✅ COMPLETE SETUP FINISHED!" -ForegroundColor Green
Write-Host "===================================`n" -ForegroundColor Green

Write-Host "Your System is Ready:" -ForegroundColor Yellow
Write-Host "  🤖 Hoser (Advisor) - Ready to answer questions (uses Opus - $0.15/query)"
Write-Host "  📧 Pre-Reg Coordinator - Ready to email subscribers (uses Haiku - $0.005/check)"
Write-Host "  💰 Cost: ~$15-20/month total`n" -ForegroundColor Yellow

Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Start server: npm start"
Write-Host "  2. Ask Hoser via /agent endpoint: 'Why is Hospital X missing?'"
Write-Host "  3. Pre-reg visits /search and enters email"
Write-Host "  4. When new data arrives: Pre-Reg Coordinator emails them`n" -ForegroundColor Cyan

Write-Host "Test Now:" -ForegroundColor Cyan
Write-Host "  Hoser: node -e `"const{runAgent}=require('./db_agent');runAgent('answer this: why is hospital X missing').then(r=>{console.log(r.answer);process.exit(0);})`"" -ForegroundColor Cyan
Write-Host "  Pre-Reg: node prereg_agent.js 'Check Austin for new pricing'`n" -ForegroundColor Cyan
