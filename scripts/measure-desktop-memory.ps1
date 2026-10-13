param([Parameter(Mandatory=$true)][int]$ReaderPid,[Parameter(Mandatory=$true)][long]$DocumentBytes)
$ErrorActionPreference='Stop'
$gbmRoot=Split-Path $PSScriptRoot -Parent
$gbmAll=Get-CimInstance Win32_Process
$gbmIds=[System.Collections.Generic.HashSet[int]]::new()
[void]$gbmIds.Add($ReaderPid)
do {
    $gbmAdded=$false
    foreach($gbmProcess in $gbmAll){
        if($gbmIds.Contains([int]$gbmProcess.ParentProcessId) -and $gbmIds.Add([int]$gbmProcess.ProcessId)){$gbmAdded=$true}
    }
} while($gbmAdded)
$gbmProcesses=@(foreach($gbmId in $gbmIds){Get-Process -Id $gbmId -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64})
if(!$gbmProcesses){throw 'Reader process is no longer running'}
$gbmReport=[ordered]@{
    measured_at=(Get-Date).ToString('o')
    document_bytes=$DocumentBytes
    working_set_bytes=($gbmProcesses | Measure-Object WorkingSet64 -Sum).Sum
    memory_scope='Single post-test sample of reader and descendant WebView2 processes; sum includes shared pages, not peak or unique memory'
    executable_sha256=(Get-FileHash -LiteralPath (Get-Process -Id $ReaderPid).Path -Algorithm SHA256).Hash
    processes=$gbmProcesses
}
$gbmReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $gbmRoot 'benchmarks\results\desktop-memory.json') -Encoding utf8
$gbmReport | ConvertTo-Json -Depth 5
