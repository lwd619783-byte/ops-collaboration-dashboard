[CmdletBinding()]
param()

$commonPath = Join-Path $PSScriptRoot 'OpsDbCredential.Common.ps1'
. $commonPath

function Assert-OpsTest {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw [System.InvalidOperationException]::new($Message)
  }
}

function Assert-OpsThrowsCode {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$Code
  )

  $caught = $null
  try {
    & $Action | Out-Null
  } catch {
    $caught = $_.Exception.Message
  }
  Assert-OpsTest `
    -Condition ($caught -eq $Code) `
    -Message "Expected $Code but received a different result."
}

function Write-OpsTestText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Contents
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Contents, $encoding)
}

function Write-OpsTestLinkedState {
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$ProjectRef,
    [Parameter(Mandatory = $true)][string]$PoolerHost
  )

  $stateDirectory = Join-Path $RepositoryRoot 'supabase\.temp'
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  Write-OpsTestText `
    -Path (Join-Path $stateDirectory 'project-ref') `
    -Contents ($ProjectRef + [Environment]::NewLine)
  Write-OpsTestText `
    -Path (Join-Path $stateDirectory 'pooler-url') `
    -Contents ("postgresql://postgres.$ProjectRef@$PoolerHost`:5432/postgres" + [Environment]::NewLine)
}

function Write-OpsTestConfig {
  param(
    [Parameter(Mandatory = $true)][string]$OperatorRoot,
    [Parameter(Mandatory = $true)][string]$TrialRef,
    [Parameter(Mandatory = $true)][string]$RecoveryRef,
    [bool]$ProductionConfigured = $false,
    [string]$TrialSecret = 'secrets/trial-db-password.clixml',
    [string]$RecoverySecret = 'secrets/recovery-db-password.clixml',
    [string]$RecoveryCa = 'certs/recovery-db-ca.pem'
  )

  $config = [ordered]@{
    schemaVersion = 1
    productionConfigured = $ProductionConfigured
    targets = [ordered]@{
      trial = [ordered]@{
        projectRef = $TrialRef
        secretRelativePath = $TrialSecret
      }
      recovery = [ordered]@{
        projectRef = $RecoveryRef
        secretRelativePath = $RecoverySecret
        caRelativePath = $RecoveryCa
      }
    }
  }
  Write-OpsTestText `
    -Path (Join-Path $OperatorRoot 'config.json') `
    -Contents (($config | ConvertTo-Json -Depth 8) + [Environment]::NewLine)
}

function New-OpsSyntheticSecret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return 'synthetic-' + [System.Convert]::ToBase64String($bytes)
}

function Save-OpsSyntheticSecret {
  param(
    [Parameter(Mandatory = $true)][string]$PlainValue,
    [Parameter(Mandatory = $true)][string]$SecretPath
  )

  $secureValue = [System.Security.SecureString]::new()
  try {
    foreach ($character in $PlainValue.ToCharArray()) {
      $secureValue.AppendChar($character)
    }
    $secureValue.MakeReadOnly()
    Export-OpsDbSecureString -SecureValue $secureValue -SecretPath $SecretPath
  } finally {
    $secureValue.Dispose()
  }
}

Assert-OpsDbWindows

foreach ($scriptName in @(
    'OpsDbCredential.Common.ps1',
    'Initialize-OpsDbCredentialStore.ps1',
    'Enter-OpsDbSession.ps1',
    'Exit-OpsDbSession.ps1',
    'Test-OpsDbCredentialBootstrap.ps1'
  )) {
  $parseTokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot $scriptName),
    [ref]$parseTokens,
    [ref]$parseErrors
  ) | Out-Null
  Assert-OpsTest `
    -Condition ($parseErrors.Count -eq 0) `
    -Message "$scriptName is not syntax-compatible with this PowerShell engine."
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  'ops-db-bootstrap-synthetic-' + [System.Guid]::NewGuid().ToString('N')
)
$repositoryRoot = Join-Path $testRoot 'repository'
$operatorRoot = Join-Path $testRoot 'local-app-data\OpsCollaborationDashboard\operator'
$trialRef = 'a' * 20
$recoveryRef = 'b' * 20
$unknownRef = 'd' * 20
$trialSecret = New-OpsSyntheticSecret
$recoverySecret = New-OpsSyntheticSecret
$trialSecretPath = Join-Path $operatorRoot 'secrets\trial-db-password.clixml'
$recoverySecretPath = Join-Path $operatorRoot 'secrets\recovery-db-password.clixml'
$caPath = Join-Path $operatorRoot 'certs\recovery-db-ca.pem'
$environmentKeys = @(
  'PGAPPNAME',
  'PGCONNECT_TIMEOUT',
  'PGDATABASE',
  'PGHOST',
  'PGPASSFILE',
  'PGPORT',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSSLCERT',
  'PGSSLKEY',
  'PGSSLMODE',
  'PGSSLPASSWORD',
  'PGSSLROOTCERT',
  'PGUSER',
  'PGPASSWORD',
  'SUPABASE_PROFILE',
  'SUPABASE_PROJECT_ID',
  'SUPABASE_WORKDIR',
  'SUPABASE_ENV',
  'SUPABASE_YES',
  'SUPABASE_DB_MIGRATIONS_ENABLED',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_TRIAL_PROJECT_REF',
  'SUPABASE_TRIAL_DB_URL',
  'RECOVERY_TARGET_PROJECT_REF',
  'RECOVERY_DB_URL',
  'RECOVERY_OPERATOR_AUTHORIZATION',
  'RECOVERY_AUTHENTICATION_EVIDENCE',
  'RECOVERY_TARGET_CLASSIFICATION',
  'RECOVERY_ACTIVE_TRIAL_PROJECT_REF',
  'RECOVERY_PRODUCTION_PROJECT_REF',
  'RECOVERY_SOURCE_ISSUER',
  'RECOVERY_TARGET_ISSUER',
  'RECOVERY_AUTH_SUBJECT',
  'RECOVERY_EXPECTED_SYSTEM_IDENTIFIER',
  'RECOVERY_EXPECTED_MIGRATION_COUNT',
  'RECOVERY_EXPECTED_LATEST_MIGRATION',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'OPS_DB_SESSION_TARGET',
  'OPS_DB_SESSION_MARKER',
  'OPS_DB_SESSION_MANAGED_KEYS'
)
$savedEnvironment = @{}
foreach ($key in $environmentKeys) {
  $savedEnvironment[$key] = [System.Environment]::GetEnvironmentVariable(
    $key,
    [System.EnvironmentVariableTarget]::Process
  )
  Remove-OpsDbProcessEnvironmentValue -Name $key
}

try {
  New-Item -ItemType Directory -Path $repositoryRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $operatorRoot -Force | Out-Null
  Write-OpsTestText `
    -Path (Join-Path $repositoryRoot 'package.json') `
    -Contents '{"name":"ops-collaboration-dashboard"}'
  Write-OpsTestConfig `
    -OperatorRoot $operatorRoot `
    -TrialRef $trialRef `
    -RecoveryRef $recoveryRef
  Save-OpsSyntheticSecret -PlainValue $trialSecret -SecretPath $trialSecretPath
  Save-OpsSyntheticSecret -PlainValue $recoverySecret -SecretPath $recoverySecretPath
  Write-OpsTestText `
    -Path $caPath `
    -Contents "-----BEGIN CERTIFICATE-----`nU1lOVEhFVElDX0NBT05MWQ==`n-----END CERTIFICATE-----`n"

  $serializedTrialSecret = Get-Content -Raw -LiteralPath $trialSecretPath
  Assert-OpsTest `
    -Condition (-not $serializedTrialSecret.Contains($trialSecret)) `
    -Message 'Synthetic plaintext was present in the DPAPI artifact.'
  $roundTrip = Import-OpsDbSecureString -SecretPath $trialSecretPath
  $roundTripPointer = [System.IntPtr]::Zero
  try {
    $roundTripPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($roundTrip)
    $roundTripPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($roundTripPointer)
    Assert-OpsTest `
      -Condition ($roundTripPlain -ceq $trialSecret) `
      -Message 'Synthetic DPAPI round trip failed.'
  } finally {
    if ($roundTripPointer -ne [System.IntPtr]::Zero) {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($roundTripPointer)
    }
    $roundTripPlain = $null
    $roundTrip.Dispose()
  }

  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $trialRef `
    -PoolerHost 'synthetic-trial.pooler.supabase.com'
  $env:PGHOST = 'synthetic-ambient-host'
  $trialOutput = @(
    Enter-OpsDbControlledSession `
      -Target Auto `
      -RepositoryRoot $repositoryRoot `
      -OperatorRoot $operatorRoot
  ) -join [Environment]::NewLine
  Assert-OpsTest -Condition ($env:PGPASSWORD -ceq $trialSecret) -Message 'Trial secret was not loaded.'
  Assert-OpsTest -Condition ($env:OPS_DB_SESSION_TARGET -eq 'TRIAL') -Message 'Trial target was not selected.'
  Assert-OpsTest -Condition (-not [string]::IsNullOrEmpty($env:SUPABASE_TRIAL_DB_URL)) -Message 'Trial route was not prepared.'
  Assert-OpsTest -Condition ([string]::IsNullOrEmpty($env:PGHOST)) -Message 'Ambient PG selector was not cleared.'
  foreach ($canary in @($trialSecret, $trialRef, 'synthetic-trial.pooler.supabase.com', $operatorRoot)) {
    Assert-OpsTest -Condition (-not $trialOutput.Contains($canary)) -Message 'Trial output exposed a protected value.'
  }
  $clearOutput = Exit-OpsDbControlledSession
  Assert-OpsTest -Condition ($clearOutput -eq 'OPS DATABASE SESSION CLEARED') -Message 'Cleanup output changed.'
  foreach ($key in @('PGPASSWORD', 'SUPABASE_TRIAL_DB_URL', 'OPS_DB_SESSION_MARKER')) {
    Assert-OpsTest -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable($key))) -Message 'Trial cleanup was incomplete.'
  }

  $env:RECOVERY_OPERATOR_AUTHORIZATION = 'user-owned-context-canary'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_AMBIENT_CONTEXT_CONFLICT' `
    -Action { Enter-OpsDbControlledSession -Target Trial -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }
  Assert-OpsTest `
    -Condition ($env:RECOVERY_OPERATOR_AUTHORIZATION -eq 'user-owned-context-canary') `
    -Message 'An unmanaged Recovery variable was deleted.'
  Remove-OpsDbProcessEnvironmentValue -Name 'RECOVERY_OPERATOR_AUTHORIZATION'

  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $recoveryRef `
    -PoolerHost 'synthetic-recovery.pooler.supabase.com'

  $env:RECOVERY_OPERATOR_AUTHORIZATION = 'user-owned-authorization-canary'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_AMBIENT_CONTEXT_CONFLICT' `
    -Action { Enter-OpsDbControlledSession -Target Recovery -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }
  Assert-OpsTest `
    -Condition ($env:RECOVERY_OPERATOR_AUTHORIZATION -eq 'user-owned-authorization-canary') `
    -Message 'An unmanaged Recovery authorization variable was deleted.'
  Assert-OpsTest `
    -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable('PGPASSWORD'))) `
    -Message 'PGPASSWORD was injected before conflict rejection.'
  Assert-OpsTest `
    -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable('RECOVERY_DB_URL'))) `
    -Message 'RECOVERY_DB_URL was injected before conflict rejection.'
  Assert-OpsTest `
    -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS'))) `
    -Message 'NODE_EXTRA_CA_CERTS was injected before conflict rejection.'
  Assert-OpsTest `
    -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable('OPS_DB_SESSION_MARKER'))) `
    -Message 'Session marker was created before conflict rejection.'
  Remove-OpsDbProcessEnvironmentValue -Name 'RECOVERY_OPERATOR_AUTHORIZATION'

  $env:RECOVERY_AUTHENTICATION_EVIDENCE = 'user-owned-evidence-canary'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_AMBIENT_CONTEXT_CONFLICT' `
    -Action { Enter-OpsDbControlledSession -Target Recovery -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }
  Assert-OpsTest `
    -Condition ($env:RECOVERY_AUTHENTICATION_EVIDENCE -eq 'user-owned-evidence-canary') `
    -Message 'An unmanaged Recovery evidence variable was deleted.'
  Remove-OpsDbProcessEnvironmentValue -Name 'RECOVERY_AUTHENTICATION_EVIDENCE'

  $env:NODE_EXTRA_CA_CERTS = 'user-owned-ca-canary'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_AMBIENT_CONTEXT_CONFLICT' `
    -Action { Enter-OpsDbControlledSession -Target Recovery -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }
  Assert-OpsTest `
    -Condition ($env:NODE_EXTRA_CA_CERTS -eq 'user-owned-ca-canary') `
    -Message 'An unmanaged CA variable was deleted.'
  Remove-OpsDbProcessEnvironmentValue -Name 'NODE_EXTRA_CA_CERTS'
  $recoveryOutput = @(
    Enter-OpsDbControlledSession `
      -Target Recovery `
      -RepositoryRoot $repositoryRoot `
      -OperatorRoot $operatorRoot
  ) -join [Environment]::NewLine
  Assert-OpsTest -Condition ($env:PGPASSWORD -ceq $recoverySecret) -Message 'Recovery secret was not loaded.'
  Assert-OpsTest -Condition ($env:OPS_DB_SESSION_TARGET -eq 'RECOVERY') -Message 'Recovery target was not selected.'
  Assert-OpsTest -Condition ($env:NODE_EXTRA_CA_CERTS -eq $caPath) -Message 'Recovery CA was not loaded.'
  Assert-OpsTest -Condition ([string]::IsNullOrEmpty($env:SUPABASE_TRIAL_DB_URL)) -Message 'Trial route survived Recovery entry.'
  foreach ($fabricatedKey in @(
      'RECOVERY_OPERATOR_AUTHORIZATION',
      'RECOVERY_AUTHENTICATION_EVIDENCE',
      'RECOVERY_TARGET_CLASSIFICATION'
    )) {
    Assert-OpsTest `
      -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable($fabricatedKey))) `
      -Message "Recovery authorization was fabricated: $fabricatedKey"
  }
  foreach ($canary in @($recoverySecret, $recoveryRef, 'synthetic-recovery.pooler.supabase.com', $caPath)) {
    Assert-OpsTest -Condition (-not $recoveryOutput.Contains($canary)) -Message 'Recovery output exposed a protected value.'
  }
  Exit-OpsDbControlledSession | Out-Null
  foreach ($key in @('PGPASSWORD', 'RECOVERY_DB_URL', 'NODE_EXTRA_CA_CERTS', 'OPS_DB_SESSION_MARKER')) {
    Assert-OpsTest -Condition ([string]::IsNullOrEmpty([System.Environment]::GetEnvironmentVariable($key))) -Message 'Recovery cleanup was incomplete.'
  }

  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $trialRef `
    -PoolerHost 'synthetic-trial.pooler.supabase.com'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_TARGET_MISMATCH' `
    -Action { Enter-OpsDbControlledSession -Target Recovery -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }
  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $recoveryRef `
    -PoolerHost 'synthetic-recovery.pooler.supabase.com'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_TARGET_MISMATCH' `
    -Action { Enter-OpsDbControlledSession -Target Trial -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }

  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $unknownRef `
    -PoolerHost 'synthetic-unknown.pooler.supabase.com'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_TARGET_UNKNOWN' `
    -Action { Enter-OpsDbControlledSession -Target Auto -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }

  $missingConfigRoot = Join-Path $testRoot 'missing-config'
  New-Item -ItemType Directory -Path $missingConfigRoot -Force | Out-Null
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_CONFIG_MISSING' `
    -Action { Enter-OpsDbControlledSession -Target Auto -RepositoryRoot $repositoryRoot -OperatorRoot $missingConfigRoot }

  Write-OpsTestConfig `
    -OperatorRoot $operatorRoot `
    -TrialRef $trialRef `
    -RecoveryRef $recoveryRef `
    -ProductionConfigured $true
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_PRODUCTION_AUTOLOAD_DENIED' `
    -Action { Enter-OpsDbControlledSession -Target Auto -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }

  Write-OpsTestConfig `
    -OperatorRoot $operatorRoot `
    -TrialRef $trialRef `
    -RecoveryRef $recoveryRef `
    -TrialSecret 'secrets/missing-trial.clixml'
  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $trialRef `
    -PoolerHost 'synthetic-trial.pooler.supabase.com'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_SECRET_MISSING' `
    -Action { Enter-OpsDbControlledSession -Target Trial -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }

  $invalidSecretPath = Join-Path $operatorRoot 'secrets\invalid-trial.clixml'
  Write-OpsTestText -Path $invalidSecretPath -Contents 'synthetic plaintext is not DPAPI CLIXML'
  Write-OpsTestConfig `
    -OperatorRoot $operatorRoot `
    -TrialRef $trialRef `
    -RecoveryRef $recoveryRef `
    -TrialSecret 'secrets/invalid-trial.clixml'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_CREDENTIAL_DECRYPT_FAILED' `
    -Action { Enter-OpsDbControlledSession -Target Trial -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }

  Write-OpsTestConfig `
    -OperatorRoot $operatorRoot `
    -TrialRef $trialRef `
    -RecoveryRef $recoveryRef `
    -RecoveryCa 'certs/missing-recovery-ca.pem'
  Write-OpsTestLinkedState `
    -RepositoryRoot $repositoryRoot `
    -ProjectRef $recoveryRef `
    -PoolerHost 'synthetic-recovery.pooler.supabase.com'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_RECOVERY_CA_MISSING' `
    -Action { Enter-OpsDbControlledSession -Target Recovery -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }

  Write-OpsTestConfig `
    -OperatorRoot $operatorRoot `
    -TrialRef $trialRef `
    -RecoveryRef $recoveryRef
  $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
  Assert-OpsThrowsCode `
    -Code 'OPS_DB_TLS_VERIFICATION_DISABLED' `
    -Action { Enter-OpsDbControlledSession -Target Recovery -RepositoryRoot $repositoryRoot -OperatorRoot $operatorRoot }
  Remove-OpsDbProcessEnvironmentValue -Name 'NODE_TLS_REJECT_UNAUTHORIZED'

  'OPS DB CREDENTIAL BOOTSTRAP SYNTHETIC TESTS PASSED'
} finally {
  if ($env:OPS_DB_SESSION_MARKER -eq $script:OpsDbSessionMarker) {
    Clear-OpsDbManagedSessionState
  }
  foreach ($key in $environmentKeys) {
    [System.Environment]::SetEnvironmentVariable(
      $key,
      $savedEnvironment[$key],
      [System.EnvironmentVariableTarget]::Process
    )
  }
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop
  }
}

Assert-OpsTest -Condition (-not (Test-Path -LiteralPath $testRoot)) -Message 'Synthetic test cleanup was incomplete.'
