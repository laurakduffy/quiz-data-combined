#!/usr/bin/env bash
#
# Linux parallel runner for the GCR sensitivity scenarios (the AWS counterpart
# of run_parallel.ps1). Each scenario is an independent process; on a big EC2
# box they all run at once, so the full sweep finishes in ~one scenario's time.
#
# Usage (env vars, all optional):
#   CONCURRENCY=32 NSAMPLES=1000000 SEED=43 ./run_parallel.sh           # all scenarios except noise_check
#   SEED=53 ./run_parallel.sh noise_check                               # the offset-seed null run
#   CONCURRENCY=8 ./run_parallel.sh r_inf_100x_up s_10x_faster          # a chosen subset
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$SCRIPT_DIR/run_gcr_sensitivity.py"
SCEN_JSON="$SCRIPT_DIR/gcr_param_scenarios.json"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

CONCURRENCY="${CONCURRENCY:-$(nproc)}"
NSAMPLES="${NSAMPLES:-1000000}"
# Batches per fund. Peak RAM per process scales with samples-PER-BATCH
# (NSAMPLES/NBATCHES), not total — so keep ~100k/batch (~3.8 GB). For 1M use 10,
# for 10M use 100, etc.
NBATCHES="${NBATCHES:-10}"
SEED="${SEED:-43}"

# Scenarios: explicit args, else every key in the JSON except noise_check
# (noise_check is only meaningful run by itself at an offset SEED).
if [ "$#" -gt 0 ]; then
  SCENARIOS=("$@")
else
  mapfile -t SCENARIOS < <(python3 -c "import json; d=json.load(open('$SCEN_JSON')); [print(k) for k in d if k!='noise_check']")
fi

# Pin each process to one math thread so parallelism is controlled here, not by
# NumPy's BLAS. Headless matplotlib backend (export_rp_csv imports pyplot).
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 MPLBACKEND=Agg

echo "Running ${#SCENARIOS[@]} scenario(s), up to $CONCURRENCY at once, ${NSAMPLES} samples in ${NBATCHES} batches, seed ${SEED}."
echo "Logs: $LOG_DIR"
start=$(date +%s)

# xargs -P gives a clean process pool and a non-zero exit if any job fails.
printf '%s\n' "${SCENARIOS[@]}" | xargs -P "$CONCURRENCY" -I {} bash -c '
  name="$1"; py="$2"; n="$3"; seed="$4"; logdir="$5"; nb="$6"
  if python3 "$py" --scenario "$name" --n-samples "$n" --n-batches "$nb" --seed "$seed" --quiet --skip-tests \
       > "$logdir/$name.log" 2> "$logdir/$name.err.log"; then
    echo "[ok]   $name"
  else
    echo "[FAIL] $name  (see $logdir/$name.err.log)"
  fi
' _ {} "$PY" "$NSAMPLES" "$SEED" "$LOG_DIR" "$NBATCHES"
rc=$?

dur=$(( $(date +%s) - start ))
echo "----------------------------------------------------------------"
printf 'Done in %dm%02ds.\n' $((dur/60)) $((dur%60))
if [ "$rc" -ne 0 ]; then
  echo "One or more scenarios FAILED — check the .err.log files in $LOG_DIR" >&2
fi
exit "$rc"
