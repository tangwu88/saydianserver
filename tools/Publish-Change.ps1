[CmdletBinding()]
param(
  [Parameter(Mandatory)][string[]]$Files,
  [Parameter(Mandatory)][string]$Message,
  [string]$RepositoryPath = (Split-Path $PSScriptRoot -Parent)
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = (Resolve-Path -LiteralPath $RepositoryPath).Path
Push-Location -LiteralPath $taskRoot
try {
  function Git-Value([string[]]$Arguments) {
    $result = & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed" }
    return ($result -join "`n").Trim()
  }
  $checkpointPath = Git-Value @('rev-parse', '--git-path', 'saydian-change.json')
  if (!(Test-Path -LiteralPath $checkpointPath)) { throw 'Run tools/Start-Change.ps1 before editing (or review and use -Resume).' }
  $checkpoint = Get-Content -LiteralPath $checkpointPath -Raw | ConvertFrom-Json
  if ((Git-Value @('branch', '--show-current')) -ne 'main') { throw 'Expected main.' }
  if ((Git-Value @('remote', 'get-url', 'origin')) -ne $checkpoint.remote) { throw 'Remote changed.' }
  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Staged changes already exist; refusing unrelated work.' }
  & git fetch origin --prune
  if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
  foreach ($ref in @('HEAD', 'origin/main')) {
    if ((Git-Value @('rev-parse', $ref)) -ne $checkpoint.base) { throw "$ref changed; reconcile without overwriting changes." }
  }
  $normalized = @($Files | ForEach-Object { $_.Replace('\', '/') } | Select-Object -Unique)
  $logs = @($normalized | Where-Object { $_ -match '^docs/implementation-log/[^/]+\.md$' })
  if ($logs.Count -eq 0) { throw 'Include a command-level implementation log in Files.' }
  foreach ($file in $normalized) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $taskRoot $file))
    if (!$absolute.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside repository: $file" }
    if (!(Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "Only explicit files are allowed: $file" }
    if ($file -match '(^|/)(node_modules|build|dist|artifacts|backups|test-results|\.git)/|(^|/)\.env(\.|$)|\.(pem|key|p12|zip|tgz|apk|dump)$') {
      if ($file -notin @('.env.example', 'deploy/.env.production.example')) { throw "Excluded artifact or secret path: $file" }
    }
  }
  $logPath = Join-Path $taskRoot $logs[-1]
  $packageManager = if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { 'pnpm.cmd' } else { 'pnpm' }
  foreach ($check in @('api:docs:check', 'tools:test', 'typecheck', 'test', 'build')) {
    & $packageManager $check
    $result = $LASTEXITCODE
    [IO.File]::AppendAllText($logPath, "`n- $([DateTime]::UtcNow.ToString('o'))：$packageManager $check，退出码 $result。`n", [Text.UTF8Encoding]::new($false))
    if ($result -ne 0) { throw "Check failed: $check; nothing staged." }
  }
  & git diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed.' }
  & git fetch origin
  if ($LASTEXITCODE -ne 0 -or (Git-Value @('rev-parse', 'origin/main')) -ne $checkpoint.base) { throw 'Remote changed during verification; work retained.' }
  foreach ($file in $normalized) {
    & git add -- $file
    if ($LASTEXITCODE -ne 0) { throw "Staging failed: $file" }
  }
  & git diff --cached --check
  if ($LASTEXITCODE -ne 0) { throw 'Staged check failed.' }
  $staged = Git-Value @('diff', '--cached', '--no-ext-diff', '--unified=0')
  if ($staged -match '(?m)^\+(-----BEGIN (OPENSSH|RSA|EC) PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})') { throw 'Possible credential found; review staged changes.' }
  & git commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw 'Commit failed; staged work retained.' }
  & git push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Push failed; local commit retained. Do not force push.' }
  $head = Git-Value @('rev-parse', 'HEAD')
  Write-Host "Pushed $head. Verify CI and Deploy production; a push alone does not prove deployment."
} finally { Pop-Location }
