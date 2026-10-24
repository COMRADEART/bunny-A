Set-Location 'C:\Users\allam\Documents\new\bun-router-s2t3r'
& npm.cmd test *> docs/ma4-s2t3r/evidence/release/regression.log
$regressionExit=$LASTEXITCODE
Set-Content docs/ma4-s2t3r/evidence/release/regression.exit $regressionExit
