param([switch]$Offline,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
$gbmRoot=Split-Path $PSScriptRoot -Parent
$gbmVersion=(Get-Content -LiteralPath (Join-Path $gbmRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$gbmRelease=if($OutputDirectory){[System.IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $gbmRoot 'release'}
$gbmPortable=Join-Path $gbmRelease 'GBMarkdown-Portable-x64'
New-Item -ItemType Directory -Path $gbmPortable -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $gbmRoot 'target\release\gbmarkdown.exe') -Destination (Join-Path $gbmPortable 'GBMarkdown.exe') -Force
Copy-Item -LiteralPath (Join-Path $gbmRoot 'public\sample.md') -Destination (Join-Path $gbmPortable 'sample.md') -Force
Copy-Item -LiteralPath (Join-Path $gbmRoot 'LICENSE') -Destination (Join-Path $gbmPortable 'LICENSE') -Force
Compress-Archive -LiteralPath $gbmPortable -DestinationPath (Join-Path $gbmRelease 'GBMarkdown-Portable-x64.zip') -Force
$gbmName=if($Offline){'GBMarkdown-Setup-x64-Offline.exe'}else{'GBMarkdown-Setup-x64.exe'}
Copy-Item -LiteralPath (Join-Path $gbmRoot "target\release\bundle\nsis\GBMarkdown_${gbmVersion}_x64-setup.exe") -Destination (Join-Path $gbmRelease $gbmName) -Force
$gbmAssetPaths=@('GBMarkdown-Portable-x64.zip','GBMarkdown-Setup-x64.exe','GBMarkdown-Setup-x64-Offline.exe') | ForEach-Object {Join-Path $gbmRelease $_} | Where-Object {Test-Path -LiteralPath $_}
$gbmHashes=$gbmAssetPaths | Get-FileHash -Algorithm SHA256
$gbmHashes | ForEach-Object {$_.Hash.ToLowerInvariant()+'  '+(Split-Path $_.Path -Leaf)} | Set-Content -LiteralPath (Join-Path $gbmRelease 'SHA256SUMS.txt') -Encoding ascii
$gbmHashes | Select-Object Hash,Path
