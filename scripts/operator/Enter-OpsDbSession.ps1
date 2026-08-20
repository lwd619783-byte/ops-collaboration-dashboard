[CmdletBinding()]
param(
  [ValidateSet('Auto', 'Trial', 'Recovery')]
  [string]$Target = 'Auto'
)

$commonPath = Join-Path $PSScriptRoot 'OpsDbCredential.Common.ps1'
. $commonPath

try {
  Assert-OpsDbWindows
  $repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $currentDirectory = [System.IO.Path]::GetFullPath((Get-Location).Path)
  if ($currentDirectory -ne [System.IO.Path]::GetFullPath($repositoryRoot)) {
    Throw-OpsDbError 'OPS_DB_REPOSITORY_ROOT_INVALID'
  }
  $operatorRoot = Get-OpsDbOperatorRoot
  Enter-OpsDbControlledSession `
    -Target $Target `
    -RepositoryRoot $repositoryRoot `
    -OperatorRoot $operatorRoot
} catch {
  if ($_.Exception.Message -match '^OPS_DB_[A-Z0-9_]+$') {
    throw [System.InvalidOperationException]::new($_.Exception.Message)
  }
  throw [System.InvalidOperationException]::new('OPS_DB_SESSION_ENTER_FAILED')
}
