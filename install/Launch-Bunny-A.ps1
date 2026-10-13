# All installed entry points use the same manifest and state checks.
param([switch]$Dashboard,[switch]$NoIsland)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Start-Bunny-Release.ps1') -Dashboard:$Dashboard -NoIsland:$NoIsland
