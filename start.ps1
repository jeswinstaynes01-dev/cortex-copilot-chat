<#
.SYNOPSIS
  Builds Cortex (React UI + Spring Boot backend) and runs it as one app.

.DESCRIPTION
  Builds the UI into cortex-chat/dist, packages the backend (which bundles that build into its
  jar), then runs the jar. Open http://localhost:8080 once the log says "Started".
  Arguments the script doesn't recognise go straight to Spring Boot, so any copilot.* setting
  can be overridden without editing files.

.EXAMPLE
  .\start.ps1

.EXAMPLE
  .\start.ps1 -SkipBuild -Port 9090

.EXAMPLE
  # A local model through Ollama: no key and no Copilot quota
  .\start.ps1 --copilot.provider.type=openai --copilot.provider.base-url=http://localhost:11434/v1 "--copilot.provider.models[0]=llama3.2"
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    # Run the existing jar without rebuilding. Builds anyway when there is no jar yet.
    [switch]$SkipBuild,
    [int]$Port = 8080,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$AppArgs
)

$ErrorActionPreference = 'Stop'
$ui = Join-Path $PSScriptRoot 'cortex-chat'
$backend = Join-Path $PSScriptRoot 'copilot-dashboard\backend'
$jar = Join-Path $backend 'target\copilot-dashboard-backend-0.0.1-SNAPSHOT.jar'

function Assert-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' was not found on PATH. $Hint"
    }
}

function Invoke-Step([string]$What, [scriptblock]$Run) {
    Write-Host "==> $What" -ForegroundColor Cyan
    & $Run
    if ($LASTEXITCODE) { throw "$What failed (exit code $LASTEXITCODE)." }
}

Assert-Command java 'Install a JDK 17 or newer.'
if (-not $env:COPILOT_CLI_PATH) {
    Assert-Command copilot 'Install the GitHub Copilot CLI (npm install -g @github/copilot) or set COPILOT_CLI_PATH.'
}

if (-not $SkipBuild -or -not (Test-Path $jar)) {
    Assert-Command node 'Install Node.js 22 LTS (Vite needs 20.19+ or 22.12+).'
    Assert-Command mvn 'Install Maven 3.9 or newer.'
    Push-Location $ui
    try {
        if (-not (Test-Path 'node_modules')) { Invoke-Step 'Installing UI dependencies' { npm ci } }
        Invoke-Step 'Building the UI' { npm run build }
    } finally { Pop-Location }
    Push-Location $backend
    try {
        Invoke-Step 'Packaging the backend' { mvn -q -DskipTests package }
    } finally { Pop-Location }
}

Write-Host "==> Starting Cortex on http://localhost:$Port (Ctrl+C to stop)" -ForegroundColor Cyan
& java -jar $jar "--server.port=$Port" @AppArgs
exit $LASTEXITCODE
