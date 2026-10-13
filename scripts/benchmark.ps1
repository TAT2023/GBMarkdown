param([Parameter(Mandatory=$true)][string]$Path,[string]$Name='1GiB-mixed')
$ErrorActionPreference='Stop'
$gbmWorkspace=Split-Path $PSScriptRoot -Parent
$gbmFile=(Resolve-Path -LiteralPath $Path).Path
$gbmResults=Join-Path $gbmWorkspace 'benchmarks\results'
New-Item -ItemType Directory -Path $gbmResults -Force | Out-Null
$gbmOutput=Join-Path $gbmResults "$Name-engine.json"
$gbmErrors=Join-Path $gbmResults "$Name-errors.log"
$gbmExe=Join-Path $gbmWorkspace 'target\release\examples\benchmark.exe'
$gbmProcess=Start-Process -FilePath $gbmExe -ArgumentList ('"'+$gbmFile+'"') -WorkingDirectory $gbmWorkspace -WindowStyle Hidden -RedirectStandardOutput $gbmOutput -RedirectStandardError $gbmErrors -PassThru
$gbmPeak=0L
while(!$gbmProcess.HasExited){
    $gbmProcess.Refresh()
    $gbmPeak=[Math]::Max($gbmPeak,$gbmProcess.WorkingSet64)
    Start-Sleep -Milliseconds 100
}
if($gbmProcess.ExitCode -ne 0){throw (Get-Content -LiteralPath $gbmErrors -Raw)}
$gbmEngine=Get-Content -LiteralPath $gbmOutput -Raw | ConvertFrom-Json
$gbmReport=[ordered]@{
    measured_at=(Get-Date).ToString('o')
    os=[System.Environment]::OSVersion.VersionString
    cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)
    system_memory_bytes=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
    engine_peak_working_set_bytes=$gbmPeak
    memory_scope='Rust benchmark process only; excludes WebView2'
    measurements=$gbmEngine
}
$gbmReport | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $gbmResults "$Name.json") -Encoding utf8
$gbmReport | ConvertTo-Json -Depth 10
