<#
.SYNOPSIS
    Build gcr-aws-bundle.tar.gz — the minimal set of files needed to run the GCR
    sensitivity pipeline on a remote (AWS) box. Run from anywhere; paths are
    resolved relative to the repo root.

    Excludes the 171 MB of model outputs/histograms/samples we don't need — the
    bundle should be only a few MB.

.EXAMPLE
    .\sensitivity-analysis\gcr-params\aws\bundle.ps1
    # -> creates .\gcr-aws-bundle.tar.gz at the repo root
#>

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $RepoRoot
try {
    $staging = Join-Path $env:TEMP ("gcr-bundle-" + (Get-Random))
    $dest    = Join-Path $staging 'quiz-demo'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    # Helper: copy a path (file or dir) into the staging tree, preserving layout.
    function Copy-Into($relPath) {
        $src = Join-Path $RepoRoot $relPath
        if (-not (Test-Path $src)) { throw "Missing required path: $relPath" }
        $target = Join-Path $dest $relPath
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -Recurse -Force $src $target
    }

    Write-Host "Staging bundle files..."

    # Sensitivity-analysis code (incl. gcr-params scripts, gcr_combine_data.py,
    # baseline.json, sa_specialBlend.json, JS utils).
    Copy-Into 'sensitivity-analysis'
    # Drop regeneratable / stale gcr-params output: keep only the 'aws' subdir;
    # scenario folders, logs, outputs and __pycache__ are all rebuilt remotely.
    $gp = Join-Path $dest 'sensitivity-analysis\gcr-params'
    Get-ChildItem $gp -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne 'aws' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    # Config (the untracked dated dataset + specialBlend)
    Copy-Into 'config'

    # JS allocation chain (marcusCalculation -> projectScoring, drOverrides)
    Copy-Into 'src\utils'

    # Python model: only the code + the two data files the run reads.
    foreach ($f in 'gcr_model.py','fund_profiles.py','export_rp_csv.py','param_distributions.py') {
        Copy-Into "all-intervention-models\gcr-models-mc\$f"
    }
    Copy-Into 'all-intervention-models\gcr-models-mc\outputs\param_percentiles.csv'
    Copy-Into 'all-intervention-models\outputs\output_data_median_2M.json'

    # Strip Windows-only and bulky bits from the staged copy
    Get-ChildItem -Recurse -Force -Path $dest -Include '__pycache__','*.pyc' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $outFile = Join-Path $RepoRoot 'gcr-aws-bundle.tar.gz'
    Write-Host "Creating $outFile ..."
    # tar ships with Windows 10+; -C into staging so the archive root is quiz-demo/
    tar -czf $outFile -C $staging 'quiz-demo'

    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
    $sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
    Write-Host ""
    Write-Host "Bundle ready: $outFile  ($sizeMB MB)" -ForegroundColor Green
    Write-Host "Next: upload it to the EC2 box (see aws/README.md)."
}
finally {
    Pop-Location
}
