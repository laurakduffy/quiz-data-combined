#!/usr/bin/env bash
#
# EC2 user-data — paste this into the "User data" box when launching the instance.
# The instance boots, runs the entire GCR sensitivity pipeline, uploads the
# results to S3, and TERMINATES ITSELF. No SSH, nothing to clean up manually.
#
# >>> EDIT ONLY THIS LINE: <<<
BUCKET="gcr-sa-2026"
#
# (Optional) bump samples 10x by changing the next line to 10000000:
NSAMPLES="1000000"
# Cap concurrent scenarios so peak RAM (~3.8 GB each) fits the box.
# 12 is safe on m7i.4xlarge (64 GB); raise/remove on a 128 GB box.
CONCURRENCY="12"
#
# Keys within the bucket (defaults are fine):
BUNDLE_KEY="gcr-aws-bundle.tar.gz"
RESULTS_KEY="gcr-results.tar.gz"
LOG_KEY="gcr-run.log"

set -xeuo pipefail
exec > /var/log/gcr-run.log 2>&1   # capture everything for debugging

# --- AWS CLI v2 (not preinstalled on AL2023) ---
dnf install -y unzip tar gzip >/dev/null 2>&1 || yum install -y unzip tar gzip
curl -s "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
AWS=/usr/local/bin/aws

# --- Fetch + unpack the bundle ---
cd /root
"$AWS" s3 cp "s3://$BUCKET/$BUNDLE_KEY" ./bundle.tar.gz
tar xzf bundle.tar.gz
find quiz-demo -name '*.sh' -exec sed -i 's/\r$//' {} +

# --- Run the pipeline (installs python/node deps itself) ---
# '|| true' so we still upload the log even if a scenario fails.
NSAMPLES="$NSAMPLES" CONCURRENCY="$CONCURRENCY" bash quiz-demo/sensitivity-analysis/gcr-params/aws/run_on_ec2.sh || true

# --- Upload results + log (always) ---
"$AWS" s3 cp /tmp/gcr-results.tar.gz "s3://$BUCKET/$RESULTS_KEY" || true
"$AWS" s3 cp /var/log/gcr-run.log    "s3://$BUCKET/$LOG_KEY"     || true

# --- Self-terminate (requires "Shutdown behavior: Terminate" set at launch) ---
shutdown -h now
