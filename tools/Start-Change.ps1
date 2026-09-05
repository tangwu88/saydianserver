[CmdletBinding()]
param(
  [string]$RepositoryPath = (Split-Path $PSScriptRoot -Parent),
  [string]$ExpectedRemote = 'https://github.com/saydian88-cmyk/saydianapp-server.git',
  [switch]$Resume
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
  # Git resolves symlinked parent directories (for example macOS /var -> /private/var)
  # differently from PowerShell. An empty repository prefix is the portable proof
  # that RepositoryPath is the checkout root.
  $gitPrefix = Git-Value @('rev-parse', '--show-prefix')
  if ($gitPrefix) { throw 'Use the repository root.' }
  if ((Git-Value @('branch', '--show-current')) -ne 'main') { throw 'Expected main; no branch was changed.' }
  if ((Git-Value @('remote', 'get-url', 'origin')) -ne $ExpectedRemote) { throw 'Remote mismatch; nothing changed.' }
  & git status --short --branch
  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Staged changes exist; review them first.' }
  & git fetch origin --prune
  if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; cannot claim the repository is current.' }
  $local = Git-Value @('rev-parse', 'HEAD')
  $remote = Git-Value @('rev-parse', 'origin/main')
  $dirty = Git-Value @('status', '--porcelain')
  if ($dirty) {
    if (!$Resume -or $local -ne $remote) { throw 'Uncommitted changes retained. Resume only after reviewing ownership and matching HEAD.' }
    Write-Host 'Resuming reviewed changes; origin/main equals HEAD. No merge performed.'
  } else {
    & git merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { throw 'Cannot fast-forward; no reset or force push is permitted.' }
  }
  $local = Git-Value @('rev-parse', 'HEAD')
  $remote = Git-Value @('rev-parse', 'origin/main')
  if ($local -ne $remote) { throw 'HEAD is not equal to origin/main; review local commits before editing.' }
  $checkpoint = Git-Value @('rev-parse', '--git-path', 'saydian-change.json')
  if (![IO.Path]::IsPathRooted($checkpoint)) { $checkpoint = Join-Path $taskRoot $checkpoint }
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($checkpoint), (@{ base = $local; remote = $ExpectedRemote; startedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  Write-Host "Ready to edit: main $local"
} finally { Pop-Location }
