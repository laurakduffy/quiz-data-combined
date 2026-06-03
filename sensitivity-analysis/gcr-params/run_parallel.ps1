<#
.SYNOPSIS
    Run all GCR sensitivity scenarios in parallel across your CPU cores.

.DESCRIPTION
    Each scenario is fully independent and runs as its own Python process, so
    this just launches several at once instead of one-after-another. On an
    8-core laptop this turns a ~7-hour serial run into roughly 1-1.5 hours.

    Each process is pinned to a single math (BLAS) thread so that N processes
    use N cores cleanly instead of fighting over them.

    Per-scenario console output is written to logs/<scenario>.log so the
    terminal stays readable; this window just shows start/done lines.

.PARAMETER MaxConcurrent
    How many scenarios to run at once. Defaults to (cores - 1) so the machine
    stays usable. On 8 cores that's 7.

.PARAMETER Scenarios
    Optional list of scenario names to run (default: all in
    gcr_param_scenarios.json). e.g. -Scenarios r_inf_100x_up, s_10x_faster

.PARAMETER NSamples
    Samples per fund per scenario (default 1,000,000 — same as the script).
    Run as 10 batches internally, so seeds Seed..Seed+9 are used per fund.

.PARAMETER Seed
    Base random seed (default 43). The 1M run spans seeds Seed..Seed+9. Use a
    different value to measure the Monte Carlo noise floor, e.g.
        .\run_parallel.ps1 -Scenarios noise_check -Seed 53
    then re-run run_gcr_alloc.js: the noise_check SI vs baseline is pure noise.

.EXAMPLE
    .\run_parallel.ps1
    Run every scenario (incl. baseline), 7 at a time, 1M samples, seeds 43-52.

.EXAMPLE
    .\run_parallel.ps1 -MaxConcurrent 4
    Gentler on the machine — leaves more cores free for other work.

.EXAMPLE
    .\run_parallel.ps1 -Scenarios noise_check -Seed 53
    Generate the offset-seed null run used to measure the noise floor.
#>

param(
    [int]$MaxConcurrent = [Math]::Max(1, [int]$env:NUMBER_OF_PROCESSORS - 1),
    [string[]]$Scenarios,
    [int]$NSamples = 1000000,
    [int]$Seed = 43
)

$ErrorActionPreference = 'Stop'

$pyScript = Join-Path $PSScriptRoot 'run_gcr_sensitivity.py'
$scenJson = Join-Path $PSScriptRoot 'gcr_param_scenarios.json'
$logDir   = Join-Path $PSScriptRoot 'logs'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Scenario list: explicit arg, else every key in the scenarios JSON EXCEPT
# noise_check (it's only meaningful when run by itself at an offset -Seed).
if (-not $Scenarios) {
    $Scenarios = (Get-Content $scenJson -Raw | ConvertFrom-Json).PSObject.Properties.Name |
        Where-Object { $_ -ne 'noise_check' }
}

# Pin each process to one math thread so parallelism is controlled here, not by
# NumPy's BLAS library (which would otherwise oversubscribe the cores).
$env:OMP_NUM_THREADS      = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:MKL_NUM_THREADS      = '1'
$env:NUMEXPR_NUM_THREADS  = '1'

Write-Host ("Running {0} scenario(s), up to {1} at a time, {2:N0} samples each (seeds {3}-{4})." -f `
    $Scenarios.Count, $MaxConcurrent, $NSamples, $Seed, ($Seed + 9))
Write-Host ("Logs: {0}" -f $logDir)
Write-Host ("Started {0}" -f (Get-Date -Format 'HH:mm:ss'))
Write-Host ('-' * 64)

$queue   = [System.Collections.Queue]::new()
$Scenarios | ForEach-Object { $queue.Enqueue($_) }

$running = @{}     # scenario name -> @{ Proc = <process>; Start = <datetime> }
$results = @()
$startAll = Get-Date

while ($queue.Count -gt 0 -or $running.Count -gt 0) {

    # Fill any free slots.
    while ($running.Count -lt $MaxConcurrent -and $queue.Count -gt 0) {
        $name = $queue.Dequeue()
        $log  = Join-Path $logDir "$name.log"
        $err  = Join-Path $logDir "$name.err.log"
        # Launch via .NET Process (reliable .ExitCode in PS 5.1, unlike Start-Process)
        # and let cmd redirect stdout/stderr to files. All paths quoted because they
        # can contain spaces (e.g. "Rethink Priorities").
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName        = 'cmd.exe'
        $psi.Arguments       = "/c python `"$pyScript`" --scenario $name --n-samples $NSamples --seed $Seed --quiet --skip-tests > `"$log`" 2> `"$err`""
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow  = $true
        $proc = [System.Diagnostics.Process]::Start($psi)
        $running[$name] = @{ Proc = $proc; Start = Get-Date }
        Write-Host ("[start] {0,-42} pid {1,-6} ({2}/{3} running, {4} queued)" -f `
            $name, $proc.Id, $running.Count, $MaxConcurrent, $queue.Count)
    }

    Start-Sleep -Seconds 2

    # Reap any that finished (snapshot keys so we can remove while iterating).
    foreach ($name in @($running.Keys)) {
        $proc = $running[$name].Proc
        if ($proc.HasExited) {
            $proc.WaitForExit()   # syncs so .ExitCode is reliably populated
            $dur    = (Get-Date) - $running[$name].Start
            $code   = $proc.ExitCode
            $status = if ($code -eq 0) { 'OK' } else { "FAIL (exit $code)" }
            Write-Host ("[done ] {0,-42} {1,7:N1}s  {2}" -f $name, $dur.TotalSeconds, $status)
            $results += [pscustomobject]@{
                Scenario = $name
                ExitCode = $code
                Minutes  = [math]::Round($dur.TotalMinutes, 2)
            }
            $running.Remove($name)
        }
    }
}

$elapsed = (Get-Date) - $startAll
Write-Host ('-' * 64)
Write-Host '================== SUMMARY =================='
$results | Sort-Object Scenario | Format-Table -AutoSize | Out-Host

$failed = @($results | Where-Object { $_.ExitCode -ne 0 })
Write-Host ("Total wall-clock: {0:N1} min for {1} scenario(s) (up to {2} parallel)." -f `
    $elapsed.TotalMinutes, $results.Count, $MaxConcurrent)

if ($failed.Count -gt 0) {
    Write-Host ("FAILED: {0}" -f (($failed.Scenario) -join ', ')) -ForegroundColor Red
    Write-Host ("Check the matching .err.log files in {0}" -f $logDir) -ForegroundColor Red
    exit 1
} else {
    Write-Host 'All scenarios completed successfully.' -ForegroundColor Green
    Write-Host 'Next step:  node sensitivity-analysis/gcr-params/run_gcr_alloc.js'
}
