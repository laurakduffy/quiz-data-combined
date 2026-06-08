#!/usr/bin/env bash
#
# Run the PRODUCTION GCR model (export_rp_csv.py) at a high sample count to refresh
# gcr-models-mc/outputs/gcr_output.csv — the CSV combine_data.py reads to build the
# canonical dataset. Decoupled from the sensitivity analysis.
#
# After this finishes, gcr_output.csv is regenerated; feed it into combine_data.py
# (locally is easiest) to produce a fresh config/datasets/YYYYMMDD.json.
#
# Runs the 3 GCR funds in PARALLEL (one process each, ~3.8 GB at 100k/batch ->
# ~12 GB peak), so an 8 vCPU / 32 GB box is plenty — no vCPU-limit increase needed,
# and ~1/3 the wall-clock of the serial export_rp_csv.py.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GCRMC="$ROOT/all-intervention-models/gcr-models-mc"
PARALLEL="$ROOT/sensitivity-analysis/gcr-params/run_gcr_model_parallel.py"

NSAMPLES="${NSAMPLES:-10000000}"
NBATCHES="${NBATCHES:-100}"   # keep NSAMPLES/NBATCHES ~100k/batch (~3.8 GB transient)
SEED="${SEED:-43}"
echo "=== GCR production model (parallel funds): $NSAMPLES samples / $NBATCHES batches / seed $SEED ==="

# --- deps ---
if command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y python3 python3-pip tar gzip >/dev/null
elif command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y >/dev/null && sudo apt-get install -y python3 python3-pip tar gzip >/dev/null
fi
# Pin numpy/scipy so the seeded MC is bit-for-bit reproducible. These are the LAST
# versions supporting Amazon Linux 2023's Python 3.9 — i.e. what the original
# unpinned baseline run installed, so this reproduces it. (They also install fine on
# Python 3.10-3.12, so this is robust to a future AMI Python bump.) Override via env.
NUMPY_SPEC="${NUMPY_SPEC:-numpy==2.0.2}"
SCIPY_SPEC="${SCIPY_SPEC:-scipy==1.13.1}"
python3 -m pip install --quiet "$NUMPY_SPEC" "$SCIPY_SPEC" matplotlib \
  || python3 -m pip install --quiet numpy scipy matplotlib
python3 -c "import numpy, scipy; print(f'deps: numpy {numpy.__version__}, scipy {scipy.__version__}')"
echo "deps ready: python $(python3 --version 2>&1)"

# --- run the 3 funds in parallel -> gcr-models-mc/outputs/gcr_output.csv ---
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 MPLBACKEND=Agg
python3 "$PARALLEL" --n-samples "$NSAMPLES" --n-batches "$NBATCHES" --seed "$SEED"

echo "=== done: $GCRMC/outputs/gcr_output.csv ($NSAMPLES samples) ==="
