$script:OpsDbSessionMarker = 'OPS_DB_CONTROLLED_SESSION_V1'
$script:OpsDbProjectRefPattern = '^[a-z]{20}$'
$script:OpsDbManagedKeyAllowlist = @(
  'PGPASSWORD',
  'SUPABASE_PROFILE',
  'SUPABASE_TRIAL_PROJECT_REF',
  'SUPABASE_TRIAL_DB_URL',
  'RECOVERY_TARGET_PROJECT_REF',
  'RECOVERY_DB_URL',
  'NODE_EXTRA_CA_CERTS',
  'OPS_DB_SESSION_TARGET'
)
$script:OpsDbAmbientPgSelectors = @(
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
  'PGUSER'
)

function Throw-OpsDbError {
  param([Parameter(Mandatory = $true)][string]$Code)

  throw [System.InvalidOperationException]::new($Code)
}

function Assert-OpsDbWindows {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    Throw-OpsDbError 'OPS_DB_WINDOWS_REQUIRED'
  }
}

function Get-OpsDbOperatorRoot {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Throw-OpsDbError 'OPS_DB_LOCALAPPDATA_UNAVAILABLE'
  }

  return [System.IO.Path]::GetFullPath(
    (Join-Path $env:LOCALAPPDATA 'OpsCollaborationDashboard\operator')
  )
}

function Assert-OpsDbRepositoryRoot {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

  $resolvedRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
  $packagePath = Join-Path $resolvedRoot 'package.json'
  $linkedStateDirectory = Join-Path $resolvedRoot 'supabase\.temp'

  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    Throw-OpsDbError 'OPS_DB_REPOSITORY_ROOT_INVALID'
  }

  try {
    $package = Get-Content -Raw -LiteralPath $packagePath -ErrorAction Stop |
      ConvertFrom-Json -ErrorAction Stop
  } catch {
    Throw-OpsDbError 'OPS_DB_REPOSITORY_ROOT_INVALID'
  }

  if ($package.name -ne 'ops-collaboration-dashboard') {
    Throw-OpsDbError 'OPS_DB_REPOSITORY_ROOT_INVALID'
  }

  if (-not (Test-Path -LiteralPath $linkedStateDirectory -PathType Container)) {
    Throw-OpsDbError 'OPS_DB_LINKED_STATE_MISSING'
  }

  return $resolvedRoot
}

function Get-OpsDbConfigPath {
  param([Parameter(Mandatory = $true)][string]$OperatorRoot)

  return Join-Path $OperatorRoot 'config.json'
}

function Read-OpsDbConfig {
  param(
    [Parameter(Mandatory = $true)][string]$OperatorRoot,
    [switch]$AllowMissing
  )

  $configPath = Get-OpsDbConfigPath -OperatorRoot $OperatorRoot
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    if ($AllowMissing) {
      return $null
    }
    Throw-OpsDbError 'OPS_DB_CONFIG_MISSING'
  }

  try {
    $config = Get-Content -Raw -LiteralPath $configPath -ErrorAction Stop |
      ConvertFrom-Json -ErrorAction Stop
  } catch {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  if ($config.schemaVersion -ne 1 -or $null -eq $config.targets) {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  if ($config.productionConfigured -eq $true -or
      $null -ne $config.targets.PSObject.Properties['production']) {
    Throw-OpsDbError 'OPS_DB_PRODUCTION_AUTOLOAD_DENIED'
  }
  if ($config.productionConfigured -isnot [System.Boolean] -or
      $config.productionConfigured -ne $false) {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  return $config
}

function Get-OpsDbTargetRecord {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][ValidateSet('Trial', 'Recovery')][string]$Target
  )

  $propertyName = $Target.ToLowerInvariant()
  $property = $Config.targets.PSObject.Properties[$propertyName]
  if ($null -eq $property -or $null -eq $property.Value) {
    return $null
  }

  $record = $property.Value
  if ($record.projectRef -notmatch $script:OpsDbProjectRefPattern -or
      [string]::IsNullOrWhiteSpace($record.secretRelativePath)) {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  if ($Target -eq 'Recovery' -and
      [string]::IsNullOrWhiteSpace($record.caRelativePath)) {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  return $record
}

function Resolve-OpsDbStorePath {
  param(
    [Parameter(Mandatory = $true)][string]$OperatorRoot,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  if ([System.IO.Path]::IsPathRooted($RelativePath)) {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  try {
    $root = [System.IO.Path]::GetFullPath($OperatorRoot)
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $RelativePath))
  } catch {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  $rootPrefix = $root.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith(
      $rootPrefix,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    Throw-OpsDbError 'OPS_DB_CONFIG_INVALID'
  }

  return $candidate
}

function Read-OpsDbLinkedState {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

  $projectRefPath = Join-Path $RepositoryRoot 'supabase\.temp\project-ref'
  $poolerUrlPath = Join-Path $RepositoryRoot 'supabase\.temp\pooler-url'
  if (-not (Test-Path -LiteralPath $projectRefPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $poolerUrlPath -PathType Leaf)) {
    Throw-OpsDbError 'OPS_DB_LINKED_STATE_MISSING'
  }

  try {
    $projectRef = (Get-Content -Raw -LiteralPath $projectRefPath -ErrorAction Stop).Trim()
    $poolerUrl = (Get-Content -Raw -LiteralPath $poolerUrlPath -ErrorAction Stop).Trim()
  } catch {
    Throw-OpsDbError 'OPS_DB_LINKED_STATE_INVALID'
  }

  if ($projectRef -notmatch $script:OpsDbProjectRefPattern -or
      [string]::IsNullOrWhiteSpace($poolerUrl)) {
    Throw-OpsDbError 'OPS_DB_LINKED_STATE_INVALID'
  }

  return [pscustomobject]@{
    ProjectRef = $projectRef
    PoolerUrl = $poolerUrl
  }
}

function ConvertTo-OpsDbPasswordlessPoolerUrl {
  param(
    [Parameter(Mandatory = $true)][string]$PoolerUrl,
    [Parameter(Mandatory = $true)][string]$ProjectRef
  )

  try {
    $uri = [System.Uri]::new($PoolerUrl, [System.UriKind]::Absolute)
  } catch {
    Throw-OpsDbError 'OPS_DB_LINKED_ROUTE_INVALID'
  }

  if ($uri.Scheme -notin @('postgres', 'postgresql') -or
      -not [string]::IsNullOrEmpty($uri.Fragment) -or
      $uri.Port -ne 5432 -or
      $uri.AbsolutePath -ne '/postgres') {
    Throw-OpsDbError 'OPS_DB_LINKED_ROUTE_INVALID'
  }

  $decodedUserInfo = [System.Uri]::UnescapeDataString($uri.UserInfo)
  $expectedUser = "postgres.$ProjectRef"
  if ($decodedUserInfo -ne $expectedUser -or $decodedUserInfo.Contains(':')) {
    Throw-OpsDbError 'OPS_DB_LINKED_ROUTE_INVALID'
  }

  $hostname = $uri.DnsSafeHost.ToLowerInvariant()
  if ($hostname -notmatch '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+pooler\.supabase\.com$') {
    Throw-OpsDbError 'OPS_DB_LINKED_ROUTE_INVALID'
  }

  if (-not [string]::IsNullOrEmpty($uri.Query) -and
      $uri.Query -ne '?sslmode=require') {
    Throw-OpsDbError 'OPS_DB_LINKED_ROUTE_INVALID'
  }

  return "postgresql://$expectedUser@$hostname`:5432/postgres?sslmode=require"
}

function Import-OpsDbSecureString {
  param([Parameter(Mandatory = $true)][string]$SecretPath)

  if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
    Throw-OpsDbError 'OPS_DB_SECRET_MISSING'
  }

  try {
    $secureValue = Import-Clixml -LiteralPath $SecretPath -ErrorAction Stop
  } catch {
    Throw-OpsDbError 'OPS_DB_CREDENTIAL_DECRYPT_FAILED'
  }

  if ($secureValue -isnot [System.Security.SecureString] -or $secureValue.Length -lt 1) {
    if ($secureValue -is [System.IDisposable]) {
      $secureValue.Dispose()
    }
    Throw-OpsDbError 'OPS_DB_CREDENTIAL_DECRYPT_FAILED'
  }

  return $secureValue
}

function Export-OpsDbSecureString {
  param(
    [Parameter(Mandatory = $true)][System.Security.SecureString]$SecureValue,
    [Parameter(Mandatory = $true)][string]$SecretPath
  )

  Assert-OpsDbWindows
  if ($SecureValue.Length -lt 1) {
    Throw-OpsDbError 'OPS_DB_CREDENTIAL_EMPTY'
  }

  $secretDirectory = Split-Path -Parent $SecretPath
  New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
  $temporaryPath = Join-Path $secretDirectory ('.pending-' + [System.Guid]::NewGuid().ToString('N') + '.clixml')
  try {
    $SecureValue | Export-Clixml -LiteralPath $temporaryPath -ErrorAction Stop
    Move-Item -LiteralPath $temporaryPath -Destination $SecretPath -Force -ErrorAction Stop
  } catch {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    Throw-OpsDbError 'OPS_DB_CREDENTIAL_STORE_WRITE_FAILED'
  }
}

function Assert-OpsDbCaFile {
  param([Parameter(Mandatory = $true)][string]$CaPath)

  if (-not (Test-Path -LiteralPath $CaPath -PathType Leaf)) {
    Throw-OpsDbError 'OPS_DB_RECOVERY_CA_MISSING'
  }

  try {
    $contents = Get-Content -Raw -LiteralPath $CaPath -ErrorAction Stop
  } catch {
    Throw-OpsDbError 'OPS_DB_RECOVERY_CA_INVALID'
  }

  if ($contents -notmatch '-----BEGIN CERTIFICATE-----' -or
      $contents -notmatch '-----END CERTIFICATE-----' -or
      $contents -match '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----') {
    Throw-OpsDbError 'OPS_DB_RECOVERY_CA_INVALID'
  }
}

function Remove-OpsDbProcessEnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  [System.Environment]::SetEnvironmentVariable(
    $Name,
    $null,
    [System.EnvironmentVariableTarget]::Process
  )
}

function Set-OpsDbProcessEnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  [System.Environment]::SetEnvironmentVariable(
    $Name,
    $Value,
    [System.EnvironmentVariableTarget]::Process
  )
}

function Clear-OpsDbManagedSessionState {
  $marker = [System.Environment]::GetEnvironmentVariable(
    'OPS_DB_SESSION_MARKER',
    [System.EnvironmentVariableTarget]::Process
  )
  $managedKeys = [System.Environment]::GetEnvironmentVariable(
    'OPS_DB_SESSION_MANAGED_KEYS',
    [System.EnvironmentVariableTarget]::Process
  )

  if ([string]::IsNullOrEmpty($marker) -and [string]::IsNullOrEmpty($managedKeys)) {
    return
  }
  if ($marker -ne $script:OpsDbSessionMarker -or [string]::IsNullOrEmpty($managedKeys)) {
    Throw-OpsDbError 'OPS_DB_SESSION_STATE_INVALID'
  }

  foreach ($key in ($managedKeys -split ';')) {
    if ($key -in $script:OpsDbManagedKeyAllowlist) {
      Remove-OpsDbProcessEnvironmentValue -Name $key
    }
  }
  Remove-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_MANAGED_KEYS'
  Remove-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_MARKER'
}

function Clear-OpsDbAmbientRouteSelectors {
  foreach ($key in @(
      'SUPABASE_PROJECT_ID',
      'SUPABASE_WORKDIR',
      'SUPABASE_ENV',
      'SUPABASE_YES',
      'SUPABASE_DB_MIGRATIONS_ENABLED',
      'SUPABASE_DB_PASSWORD'
    ) + $script:OpsDbAmbientPgSelectors) {
    Remove-OpsDbProcessEnvironmentValue -Name $key
  }
}

function Test-OpsDbProcessEnvironmentValuePresent {
  param([Parameter(Mandatory = $true)][string]$Name)

  return -not [string]::IsNullOrEmpty(
    [System.Environment]::GetEnvironmentVariable(
      $Name,
      [System.EnvironmentVariableTarget]::Process
    )
  )
}

function Test-OpsDbAmbientRecoveryContextPresent {
  $ambientRecoveryContext = @(
    Get-ChildItem Env:RECOVERY_* -ErrorAction SilentlyContinue |
      Where-Object { -not [string]::IsNullOrEmpty($_.Value) }
  )
  return $ambientRecoveryContext.Count -gt 0
}

function Select-OpsDbTarget {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('Auto', 'Trial', 'Recovery')][string]$RequestedTarget,
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$LinkedProjectRef
  )

  $trial = Get-OpsDbTargetRecord -Config $Config -Target Trial
  $recovery = Get-OpsDbTargetRecord -Config $Config -Target Recovery
  $matches = @()
  if ($null -ne $trial -and $trial.projectRef -eq $LinkedProjectRef) {
    $matches += 'Trial'
  }
  if ($null -ne $recovery -and $recovery.projectRef -eq $LinkedProjectRef) {
    $matches += 'Recovery'
  }

  if ($matches.Count -ne 1) {
    Throw-OpsDbError 'OPS_DB_TARGET_UNKNOWN'
  }
  if ($RequestedTarget -ne 'Auto' -and $RequestedTarget -ne $matches[0]) {
    Throw-OpsDbError 'OPS_DB_TARGET_MISMATCH'
  }

  return $matches[0]
}

function Enter-OpsDbControlledSession {
  param(
    [ValidateSet('Auto', 'Trial', 'Recovery')][string]$Target = 'Auto',
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$OperatorRoot
  )

  Assert-OpsDbWindows
  $repository = Assert-OpsDbRepositoryRoot -RepositoryRoot $RepositoryRoot
  $config = Read-OpsDbConfig -OperatorRoot $OperatorRoot
  $linkedState = Read-OpsDbLinkedState -RepositoryRoot $repository
  $selectedTarget = Select-OpsDbTarget `
    -RequestedTarget $Target `
    -Config $config `
    -LinkedProjectRef $linkedState.ProjectRef
  $targetRecord = Get-OpsDbTargetRecord -Config $config -Target $selectedTarget
  $databaseUrl = ConvertTo-OpsDbPasswordlessPoolerUrl `
    -PoolerUrl $linkedState.PoolerUrl `
    -ProjectRef $linkedState.ProjectRef
  $secretPath = Resolve-OpsDbStorePath `
    -OperatorRoot $OperatorRoot `
    -RelativePath $targetRecord.secretRelativePath
  $securePassword = Import-OpsDbSecureString -SecretPath $secretPath

  $caPath = $null
  if ($selectedTarget -eq 'Recovery') {
    $caPath = Resolve-OpsDbStorePath `
      -OperatorRoot $OperatorRoot `
      -RelativePath $targetRecord.caRelativePath
    Assert-OpsDbCaFile -CaPath $caPath
  }

  if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') {
    $securePassword.Dispose()
    Throw-OpsDbError 'OPS_DB_TLS_VERIFICATION_DISABLED'
  }

  $bstr = [System.IntPtr]::Zero
  $plainPassword = $null
  $managedKeys = @('PGPASSWORD', 'SUPABASE_PROFILE', 'OPS_DB_SESSION_TARGET')
  $injectionStarted = $false
  try {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrEmpty($plainPassword)) {
      Throw-OpsDbError 'OPS_DB_CREDENTIAL_DECRYPT_FAILED'
    }

    Clear-OpsDbManagedSessionState
    if (Test-OpsDbAmbientRecoveryContextPresent) {
      Throw-OpsDbError 'OPS_DB_AMBIENT_CONTEXT_CONFLICT'
    }
    if ($selectedTarget -eq 'Recovery' -and
        (Test-OpsDbProcessEnvironmentValuePresent -Name 'NODE_EXTRA_CA_CERTS')) {
      Throw-OpsDbError 'OPS_DB_AMBIENT_CONTEXT_CONFLICT'
    }
    Clear-OpsDbAmbientRouteSelectors
    $injectionStarted = $true
    Set-OpsDbProcessEnvironmentValue -Name 'PGPASSWORD' -Value $plainPassword
    Set-OpsDbProcessEnvironmentValue -Name 'SUPABASE_PROFILE' -Value 'supabase'
    Set-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_TARGET' -Value $selectedTarget.ToUpperInvariant()

    if ($selectedTarget -eq 'Trial') {
      Set-OpsDbProcessEnvironmentValue -Name 'SUPABASE_TRIAL_PROJECT_REF' -Value $linkedState.ProjectRef
      Set-OpsDbProcessEnvironmentValue -Name 'SUPABASE_TRIAL_DB_URL' -Value $databaseUrl
      $managedKeys += @('SUPABASE_TRIAL_PROJECT_REF', 'SUPABASE_TRIAL_DB_URL')
    } else {
      Remove-OpsDbProcessEnvironmentValue -Name 'SUPABASE_TRIAL_PROJECT_REF'
      Remove-OpsDbProcessEnvironmentValue -Name 'SUPABASE_TRIAL_DB_URL'
      Set-OpsDbProcessEnvironmentValue -Name 'RECOVERY_TARGET_PROJECT_REF' -Value $linkedState.ProjectRef
      Set-OpsDbProcessEnvironmentValue -Name 'RECOVERY_DB_URL' -Value $databaseUrl
      Set-OpsDbProcessEnvironmentValue -Name 'NODE_EXTRA_CA_CERTS' -Value $caPath
      $managedKeys += @('RECOVERY_TARGET_PROJECT_REF', 'RECOVERY_DB_URL', 'NODE_EXTRA_CA_CERTS')
    }

    Set-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_MANAGED_KEYS' -Value ($managedKeys -join ';')
    Set-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_MARKER' -Value $script:OpsDbSessionMarker
  } catch {
    if ($env:OPS_DB_SESSION_MARKER -eq $script:OpsDbSessionMarker) {
      Clear-OpsDbManagedSessionState
    } elseif ($injectionStarted) {
      foreach ($key in $managedKeys) {
        if ($key -in $script:OpsDbManagedKeyAllowlist) {
          Remove-OpsDbProcessEnvironmentValue -Name $key
        }
      }
      Remove-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_MANAGED_KEYS'
      Remove-OpsDbProcessEnvironmentValue -Name 'OPS_DB_SESSION_MARKER'
    }
    throw
  } finally {
    if ($bstr -ne [System.IntPtr]::Zero) {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $plainPassword = $null
    $securePassword.Dispose()
  }

  $tlsCaStatus = if ($selectedTarget -eq 'Recovery') { 'PASS' } else { 'NOT REQUIRED' }
  @(
    '========================================',
    ' OPS DATABASE CONTROLLED SESSION',
    '========================================',
    (' TARGET       : ' + $selectedTarget.ToUpperInvariant()),
    ' LINKED       : PASS',
    ' POOLER       : PASS',
    (' TLS CA       : ' + $tlsCaStatus),
    ' CREDENTIAL   : LOADED',
    ' WRITE AUTH   : NOT GRANTED',
    ' APPLY AUTH   : NOT GRANTED',
    '========================================'
  )
}

function Exit-OpsDbControlledSession {
  Assert-OpsDbWindows
  Clear-OpsDbManagedSessionState
  'OPS DATABASE SESSION CLEARED'
}
