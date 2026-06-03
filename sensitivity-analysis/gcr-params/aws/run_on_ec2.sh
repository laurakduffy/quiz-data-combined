#!/usr/bin/env bash
#
# One-shot bootstrap to run the full GCR sensitivity pipeline on a fresh EC2 box.
# Run it from the extracted bundle root after uploading + unpacking the bundle:
#
#     tar xzf gcr-aws-bundle.tar.gz
#     bash quiz-demo/sensitivity-analysis/gcr-params/aws/run_on_ec2.sh
#
# Produces /tmp/gcr-results.tar.gz with the SI CSVs and per-scenario outputs.
#
set -euo pipefail

# Repo root = three levels up from this script (.../gcr-params/aws/run_on_ec2.sh)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GP="$ROOT/sensitivity-analysis/gcr-params"
cd "$ROOT"

NSAMPLES="${NSAMPLES:-1000000}"
CONCURRENCY="${CONCURRENCY:-$(nproc)}"
echo "=== repo: $ROOT | $(nproc) vCPUs | concurrency $CONCURRENCY | $NSAMPLES samples ==="

# --- 1. Dependencies -------------------------------------------------------
if command -v dnf >/dev/null 2>&1; then          # Amazon Linux 2023 / Fedora
  sudo dnf install -y python3 python3-pip nodejs tar gzip >/dev/null
elif command -v apt-get >/dev/null 2>&1; then     # Ubuntu / Debian
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y python3 python3-pip nodejs tar gzip >/dev/null
fi
python3 -m pip install --quiet --upgrade pip
python3 -m pip install --quiet numpy scipy matplotlib
echo "deps ready: python $(python3 --version 2>&1), node $(node --version 2>&1)"

# --- 2. Run scenarios ------------------------------------------------------
# Main set at seed 43 (baseline + 16 scenarios), then the offset-seed null.
echo "=== main scenarios (seed 43) ==="
CONCURRENCY="$CONCURRENCY" NSAMPLES="$NSAMPLES" SEED=43 bash "$GP/run_parallel.sh"
echo "=== noise_check (seed 53) ==="
CONCURRENCY="$CONCURRENCY" NSAMPLES="$NSAMPLES" SEED=53 bash "$GP/run_parallel.sh" noise_check

# --- 3. Allocation + sensitivity index ------------------------------------
echo "=== allocation ==="
node "$GP/run_gcr_alloc.js"

# --- 4. Package results ----------------------------------------------------
cd "$GP"
# All result dirs (scenario folders + outputs/), excluding infra dirs.
mapfile -t RESULT_DIRS < <(find . -maxdepth 1 -type d \
  ! -name '.' ! -name 'logs' ! -name '__pycache__' ! -name 'aws' -printf '%P\n')
tar czf /tmp/gcr-results.tar.gz "${RESULT_DIRS[@]}"
echo ""
echo "=================================================================="
echo "DONE. Results: /tmp/gcr-results.tar.gz"
echo "Key file: sensitivity-analysis/gcr-params/outputs/fund/gcr_sensitivity_index.csv"
echo "Noise floor = the noise_check row's sensitivity_index."
echo "=================================================================="
