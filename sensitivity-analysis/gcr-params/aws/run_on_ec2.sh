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
NBATCHES="${NBATCHES:-10}"     # keep NSAMPLES/NBATCHES ~100k/batch for ~3.8 GB/proc
CONCURRENCY="${CONCURRENCY:-$(nproc)}"
echo "=== repo: $ROOT | $(nproc) vCPUs | concurrency $CONCURRENCY | $NSAMPLES samples / $NBATCHES batches ==="

# --- 1. Dependencies -------------------------------------------------------
if command -v dnf >/dev/null 2>&1; then          # Amazon Linux 2023 / Fedora
  sudo dnf install -y python3 python3-pip nodejs tar gzip >/dev/null
elif command -v apt-get >/dev/null 2>&1; then     # Ubuntu / Debian
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y python3 python3-pip nodejs tar gzip >/dev/null
fi
# Don't --upgrade pip: AL2023's pip is rpm-managed and can't self-uninstall
# (it errors "Cannot uninstall pip ... RECORD file not found"). The stock pip
# installs the wheels we need fine. --break-system-packages is harmless if the
# pip is new enough to enforce PEP 668, ignored otherwise.
python3 -m pip install --quiet numpy scipy matplotlib \
  || python3 -m pip install --quiet --break-system-packages numpy scipy matplotlib
echo "deps ready: python $(python3 --version 2>&1), node $(node --version 2>&1)"

# --- 2. Run scenarios ------------------------------------------------------
# Main set (seed 43) and the offset-seed null (seed 53) run CONCURRENTLY so the
# noise_check doesn't add a second full pass — peak processes = CONCURRENCY + 1,
# so size CONCURRENCY to fit the box's RAM (~per-process peak scales with
# NSAMPLES/NBATCHES). '|| true' so one failing scenario never aborts the rest.
echo "=== scenarios: main (seed 43) + noise_check (seed 53), concurrent ==="
CONCURRENCY="$CONCURRENCY" NSAMPLES="$NSAMPLES" NBATCHES="$NBATCHES" SEED=43 bash "$GP/run_parallel.sh" &
MAIN_PID=$!
CONCURRENCY="$CONCURRENCY" NSAMPLES="$NSAMPLES" NBATCHES="$NBATCHES" SEED=53 bash "$GP/run_parallel.sh" noise_check &
NOISE_PID=$!
wait "$MAIN_PID" || true
wait "$NOISE_PID" || true

# --- 3. Allocation + sensitivity index ------------------------------------
echo "=== allocation ==="
node "$GP/run_gcr_alloc.js" || true

# --- 4. Package results ----------------------------------------------------
cd "$GP"
# Result dirs (scenario folders + outputs/) AND logs/ (so per-scenario error
# logs come back for debugging even if everything failed). Exclude only infra.
mapfile -t RESULT_DIRS < <(find . -maxdepth 1 -type d \
  ! -name '.' ! -name '__pycache__' ! -name 'aws' -printf '%P\n')
# '|| true' + a fallback so a totally-empty run still uploads the logs.
tar czf /tmp/gcr-results.tar.gz "${RESULT_DIRS[@]}" 2>/dev/null \
  || tar czf /tmp/gcr-results.tar.gz logs 2>/dev/null || true
echo ""
echo "=================================================================="
echo "DONE. Results: /tmp/gcr-results.tar.gz"
echo "Key file: sensitivity-analysis/gcr-params/outputs/fund/gcr_sensitivity_index.csv"
echo "Noise floor = the noise_check row's sensitivity_index."
echo "=================================================================="
