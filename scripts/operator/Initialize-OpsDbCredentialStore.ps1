[CmdletBinding()]
param(
  [ValidateSet('Trial', 'Recovery', 'Both')]
  [string]$Target = 'Both'
)

$commonPath = Join-Path $PSScriptRoot 'OpsDbCredential.Common.ps1'
. $commonPath

function Read-OpsDbProjectRef {
  param([Parameter(Mandatory = $true)][string]$Label)

  $value = Read-Host "$Label project ref"
  if ($value -notmatch '^[a-z]{20}$') {
    Throw-OpsDbError 'OPS_DB_PROJECT_REF_INVALID'
  }
  return $value
}

function Confirm-OpsDbOverwrite {
  param([Parameter(Mandatory = $true)][string]$Label)

  $confirmation = Read-Host "$Label state exists. Type OVERWRITE to replace it"
  if ($confirmation -cne 'OVERWRITE') {
    Throw-OpsDbError 'OPS_DB_CREDENTIAL_OVERWRITE_DENIED'
  }
}

function Set-OpsDbConfigTarget {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][ValidateSet('Trial', 'Recovery')][string]$TargetName,
    [Parameter(Mandatory = $true)][string]$ProjectRef
  )

  $propertyName = $TargetName.ToLowerInvariant()
  $record = [ordered]@{
    projectRef = $ProjectRef
    secretRelativePath = "secrets/$propertyName-db-password.clixml"
  }
  if ($TargetName -eq 'Recovery') {
    $record.caRelativePath = 'certs/recovery-db-ca.pem'
  }
  $Config.targets | Add-Member `
    -NotePropertyName $propertyName `
    -NotePropertyValue ([pscustomobject]$record) `
    -Force
}

function Save-OpsDbConfig {
  param(
    [Parameter(Mandatory = $true)]$Config,
    [Parameter(Mandatory = $true)][string]$OperatorRoot
  )

  $configPath = Get-OpsDbConfigPath -OperatorRoot $OperatorRoot
  $json = $Config | ConvertTo-Json -Depth 8
  try {
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, $encoding)
  } catch {
    Throw-OpsDbError 'OPS_DB_CONFIG_WRITE_FAILED'
  }
}

try {
  Assert-OpsDbWindows
  $operatorRoot = Get-OpsDbOperatorRoot
  New-Item -ItemType Directory -Path $operatorRoot -Force | Out-Null

  $config = Read-OpsDbConfig -OperatorRoot $operatorRoot -AllowMissing
  if ($null -eq $config) {
    $config = [pscustomobject][ordered]@{
      schemaVersion = 1
      productionConfigured = $false
      targets = [pscustomobject][ordered]@{}
    }
  }

  $targets = if ($Target -eq 'Both') { @('Trial', 'Recovery') } else { @($Target) }
  foreach ($targetName in $targets) {
    $existingRecord = Get-OpsDbTargetRecord -Config $config -Target $targetName
    $propertyName = $targetName.ToLowerInvariant()
    $secretRelativePath = "secrets/$propertyName-db-password.clixml"
    $secretPath = Resolve-OpsDbStorePath `
      -OperatorRoot $operatorRoot `
      -RelativePath $secretRelativePath
    $existingCa = $false
    if ($targetName -eq 'Recovery') {
      $existingCaPath = Resolve-OpsDbStorePath `
        -OperatorRoot $operatorRoot `
        -RelativePath 'certs/recovery-db-ca.pem'
      $existingCa = Test-Path -LiteralPath $existingCaPath
    }
    if ($null -ne $existingRecord -or
        (Test-Path -LiteralPath $secretPath) -or
        $existingCa) {
      Confirm-OpsDbOverwrite -Label $targetName
    }

    $projectRef = Read-OpsDbProjectRef -Label $targetName
    $securePassword = Read-Host "$targetName database password" -AsSecureString
    try {
      $sourceCaPath = $null
      $destinationCaPath = $null
      if ($targetName -eq 'Recovery') {
        $sourceCaPath = Read-Host 'Recovery Server root certificate path'
        Assert-OpsDbCaFile -CaPath $sourceCaPath
        $destinationCaPath = Resolve-OpsDbStorePath `
          -OperatorRoot $operatorRoot `
          -RelativePath 'certs/recovery-db-ca.pem'
      }

      Export-OpsDbSecureString -SecureValue $securePassword -SecretPath $secretPath
      if ($targetName -eq 'Recovery') {
        New-Item -ItemType Directory -Path (Split-Path -Parent $destinationCaPath) -Force | Out-Null
        try {
          if ([System.IO.Path]::GetFullPath($sourceCaPath) -ne
              [System.IO.Path]::GetFullPath($destinationCaPath)) {
            Copy-Item -LiteralPath $sourceCaPath -Destination $destinationCaPath -Force -ErrorAction Stop
          }
        } catch {
          Throw-OpsDbError 'OPS_DB_RECOVERY_CA_WRITE_FAILED'
        }
      }
    } finally {
      $securePassword.Dispose()
    }

    Set-OpsDbConfigTarget `
      -Config $config `
      -TargetName $targetName `
      -ProjectRef $projectRef
  }

  $config.productionConfigured = $false
  Save-OpsDbConfig -Config $config -OperatorRoot $operatorRoot
  'OPS DB CREDENTIAL STORE INITIALIZED'
} catch {
  if ($_.Exception.Message -match '^OPS_DB_[A-Z0-9_]+$') {
    throw [System.InvalidOperationException]::new($_.Exception.Message)
  }
  throw [System.InvalidOperationException]::new('OPS_DB_INITIALIZATION_FAILED')
}
