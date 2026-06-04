<#
.SYNOPSIS
    Build an AWS upload bundle for the GCR pipeline (a few MB; excludes the 171 MB
    of model outputs/histograms/samples).

    Default        -> gcr-aws-bundle.tar.gz       (FULL: runs the sensitivity analysis)
    -Baseline      -> gcr-baseline-bundle.tar.gz  (TRIMMED: runs only the GCR model to
                      refresh gcr_output.csv; combine_data.py is run locally afterward)

    The two have different names so uploading one never overwrites the other.

.EXAMPLE
    .\bundle.ps1            # full SA bundle
.EXAMPLE
    .\bundle.ps1 -Baseline  # standalone baseline-model bundle
#>

param([switch]$Baseline)

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

    Write-Host ("Staging {0} bundle files..." -f $(if ($Baseline) {'baseline'} else {'full'}))

    # --- Python model code: needed by BOTH bundles ---
    # ALL root-level modules (e.g. risk_profiles.py) AND all gcr-models-mc modules —
    # they sit on the two sys.path entries the scripts add, so cherry-picking misses
    # transitive imports. All .py total ~165 KB.
    $aim = Join-Path $dest 'all-intervention-models'
    New-Item -ItemType Directory -Force -Path (Join-Path $aim 'gcr-models-mc') | Out-Null
    Copy-Item (Join-Path $RepoRoot 'all-intervention-models\*.py') $aim
    Copy-Item (Join-Path $RepoRoot 'all-intervention-models\gcr-models-mc\*.py') (Join-Path $aim 'gcr-models-mc')
    Copy-Into 'all-intervention-models\gcr-models-mc\outputs\param_percentiles.csv'

    if ($Baseline) {
        # Baseline-only: the parallel model runner + its bootstrap. No SA scenarios,
        # no config, no JS — the model just writes gcr_output.csv; combine_data.py
        # runs locally afterward.
        Copy-Into 'sensitivity-analysis\gcr-params\run_gcr_model_parallel.py'
        Copy-Into 'sensitivity-analysis\gcr-params\aws\run_gcr_model.sh'
        $outName = 'gcr-baseline-bundle.tar.gz'
    }
    else {
        # Full SA bundle: scenarios, allocation, datasets, JS chain.
        Copy-Into 'sensitivity-analysis'
        # Drop regeneratable / stale gcr-params output: keep only the 'aws' subdir.
        $gp = Join-Path $dest 'sensitivity-analysis\gcr-params'
        Get-ChildItem $gp -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne 'aws' } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Into 'config'
        Copy-Into 'src\utils'
        # node needs to know the .js files are ES modules.
        Set-Content -Path (Join-Path $dest 'package.json') -Value '{ "type": "module" }' -Encoding ascii
        Copy-Into 'all-intervention-models\outputs\output_data_median_2M.json'
        $outName = 'gcr-aws-bundle.tar.gz'
    }

    # Strip Windows-only / bulky bits from the staged copy
    Get-ChildItem -Recurse -Force -Path $dest -Include '__pycache__','*.pyc' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $outFile = Join-Path $RepoRoot $outName
    Write-Host "Creating $outFile ..."
    # tar ships with Windows 10+; -C into staging so the archive root is quiz-demo/
    tar -czf $outFile -C $staging 'quiz-demo'

    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
    $sizeMB = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
    Write-Host ""
    Write-Host "Bundle ready: $outFile  ($sizeMB MB)" -ForegroundColor Green
    Write-Host "Next: upload it to S3 (see aws/README.md)."
}
finally {
    Pop-Location
}
