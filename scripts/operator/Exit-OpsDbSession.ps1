[CmdletBinding()]
param()

$commonPath = Join-Path $PSScriptRoot 'OpsDbCredential.Common.ps1'
. $commonPath

try {
  Exit-OpsDbControlledSession
} catch {
  if ($_.Exception.Message -match '^OPS_DB_[A-Z0-9_]+$') {
    throw [System.InvalidOperationException]::new($_.Exception.Message)
  }
  throw [System.InvalidOperationException]::new('OPS_DB_SESSION_EXIT_FAILED')
}
