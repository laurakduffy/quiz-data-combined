# Running the GCR sensitivity sweep on AWS

The GCR model is **memory-heavy** (~3.8 GB per process at 1M samples), so a laptop
can only run a couple at a time. A single memory-rich EC2 box runs **all scenarios
at once** in well under an hour.

This is the **hands-off** version: you paste one script when launching the
instance, and it **runs everything and terminates itself**. No SSH, no AWS CLI on
your machine, nothing to remember to shut down. Everything happens in the AWS
Console (web).

**Time:** ~10 min of clicks + ~50 min unattended. **Cost:** ~$1–2.

> If you'd rather drive it by hand over SSH, see **Manual alternative** at the bottom.

---

## Step 1 — Build the bundle (on your laptop)

```powershell
.\sensitivity-analysis\gcr-params\aws\bundle.ps1
```

Creates `gcr-aws-bundle.tar.gz` (~5 MB) at the repo root.

## Step 2 — Make an S3 bucket and upload the bundle

AWS Console → **S3** → **Create bucket**:
- Name: something globally unique, e.g. `gcr-sa-<your-initials>-2026`. **Write it down** — you'll paste it in Step 4.
- Leave everything else default → **Create bucket**.

Open the bucket → **Upload** → **Add files** → pick `gcr-aws-bundle.tar.gz` → **Upload**.

## Step 3 — Create an IAM role so the instance can use that bucket

AWS Console → **IAM** → **Roles** → **Create role**:
1. Trusted entity type: **AWS service**; Use case: **EC2** → **Next**.
2. Permissions: search and check **AmazonS3FullAccess** → **Next**.
   *(Tighter option: instead, create an inline policy allowing `s3:GetObject`/`s3:PutObject` on just `arn:aws:s3:::YOUR-BUCKET/*`.)*
3. Role name: `gcr-sa-runner` → **Create role**.

## Step 4 — Launch the instance

First, open [user-data.sh](user-data.sh) and change **one line** —
`BUCKET="REPLACE-WITH-YOUR-BUCKET-NAME"` — to your bucket from Step 2. Copy the whole file.

AWS Console → **EC2** → **Launch instance**:
- **Name:** `gcr-sensitivity`
- **AMI:** Amazon Linux 2023 (default)
- **Instance type:** `m7i.8xlarge` (32 vCPU, 128 GB) — runs all 17 scenarios at once.
  *(Cheaper: `m7i.4xlarge` = 16 vCPU/64 GB; works, just tighter and a bit slower.)*
- **Key pair:** "Proceed without a key pair" (you won't SSH in).
- **Network settings** → Edit → you can leave the default; **no inbound rules needed**.
- **Configure storage:** set the root volume to **30 GB**.
- **Advanced details** (expand):
  - **IAM instance profile:** select `gcr-sa-runner`.
  - **Shutdown behavior:** **Terminate**  ← important; this is how it self-deletes.
  - **User data:** paste the edited contents of `user-data.sh`.
- **Launch instance.**

## Step 5 — Wait, then download results

The instance installs deps, runs the 17 scenarios (seed 43) + the `noise_check`
null run (seed 53), computes the allocation, uploads results, and terminates —
all unattended (~50 min).

Watch your **S3 bucket** (refresh it):
- When **`gcr-results.tar.gz`** appears, it's done. Download it.
- A **`gcr-run.log`** also appears — that's the full run log if you need to check anything.

In EC2, the instance will move to **Terminated** on its own (so billing stops).

Unpack the results into place (laptop, PowerShell from the repo root):

```powershell
tar -xzf gcr-results.tar.gz -C sensitivity-analysis\gcr-params
```

---

## Reading the result

Open `sensitivity-analysis\gcr-params\outputs\fund\gcr_sensitivity_index.csv`.
**Find the `noise_check` row first** — its `sensitivity_index` is your Monte-Carlo
noise floor. Any scenario at or below it isn't a real signal. If that floor is
≤ ~1pp, the analysis is solid at 1M samples.

Want 10× samples (the box has the RAM for it)? Before launching, change one line in
`user-data.sh`: `NSAMPLES="10000000"`. Everything else is identical.

---

## If something goes wrong

- No `gcr-results.tar.gz` after ~70 min → download **`gcr-run.log`** from the bucket
  and check the tail for the error.
- Instance didn't terminate → you forgot **Shutdown behavior: Terminate**; terminate
  it manually in EC2 (**Instance state → Terminate**).
- "Access denied" in the log → the IAM role (Step 3) isn't attached or lacks S3 access.

## Manual alternative (SSH, if you prefer)

If you'd rather run it yourself instead of the user-data automation: launch the same
instance **with** a key pair and SSH inbound allowed, skip the user-data, then:

```bash
scp -i key.pem gcr-aws-bundle.tar.gz ec2-user@<IP>:~      # from laptop
ssh -i key.pem ec2-user@<IP>
tar xzf gcr-aws-bundle.tar.gz
find quiz-demo -name '*.sh' -exec sed -i 's/\r$//' {} +
bash quiz-demo/sensitivity-analysis/gcr-params/aws/run_on_ec2.sh
# back on the laptop:
scp -i key.pem ec2-user@<IP>:/tmp/gcr-results.tar.gz .
```

Then **terminate the instance manually** in the EC2 console.

## Tuning knobs (env vars; used by `run_on_ec2.sh` / `run_parallel.sh`)

| Var | Default | Meaning |
|-----|---------|---------|
| `NSAMPLES` | `1000000` | MC samples per fund per scenario |
| `CONCURRENCY` | `nproc` | how many scenarios run at once |
| `SEED` | `43` (main) / `53` (noise_check) | base seed; the 1M run spans `SEED..SEED+9` |
