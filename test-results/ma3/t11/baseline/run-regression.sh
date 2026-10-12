#!/usr/bin/env bash
# M-A-3 T11 baseline/final regression: each part runs separately so its summary and exit code are kept.
# Usage: run-regression.sh <outdir>
cd "$(dirname "$0")/../../../.."
out=${1:-test-results/ma3/t11/baseline}
mkdir -p "$out"
TEST=$(node -e 'console.log(require("./package.json").scripts.test)')
P1=$(echo "$TEST" | awk -F' && ' '{print $1}')
P2=$(echo "$TEST" | awk -F' && ' '{print $2}')
P3=$(echo "$TEST" | awk -F' && ' '{print $3}')
run() { local name=$1; shift; local t0=$(date +%s); bash -c "$*" > "$out/$name.log" 2>&1; local rc=$?; echo "$name exit=$rc seconds=$(( $(date +%s) - t0 ))" | tee -a "$out/summary.txt"; }
: > "$out/summary.txt"
echo "source $(git rev-parse HEAD) started $(date -u +%FT%TZ)" >> "$out/summary.txt"
run pretest npm run pretest
run scripts "$P1"
run library "$P2"
run agent "$P3"
run ui npm run test:ui
run typecheck npm run typecheck
run lint npm run lint
run build npm run build
echo "finished $(date -u +%FT%TZ)" >> "$out/summary.txt"
