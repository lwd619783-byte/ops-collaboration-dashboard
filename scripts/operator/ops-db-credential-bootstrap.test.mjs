import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const operatorDirectory = join(process.cwd(), 'scripts', 'operator')
const productionScripts = [
  'OpsDbCredential.Common.ps1',
  'Initialize-OpsDbCredentialStore.ps1',
  'Enter-OpsDbSession.ps1',
  'Exit-OpsDbSession.ps1',
]

function scriptText(name) {
  return readFileSync(join(operatorDirectory, name), 'utf8')
}

function powershellEngines() {
  const engines = []
  const windowsPowerShell = process.env.SystemRoot
    ? join(
        process.env.SystemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : undefined
  if (windowsPowerShell && existsSync(windowsPowerShell)) {
    engines.push({
      name: 'Windows PowerShell 5.1',
      executable: windowsPowerShell,
    })
  }

  const pwshProbe = spawnSync(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ],
    {
      encoding: 'utf8',
    },
  )
  if (pwshProbe.status === 0) {
    engines.push({
      name: `PowerShell ${pwshProbe.stdout.trim()}`,
      executable: 'pwsh',
    })
  }
  return engines
}

function cleanWindowsPowerShellEnvironment(engineName) {
  const environment = { ...process.env }
  if (engineName === 'Windows PowerShell 5.1') {
    const userProfile = environment.USERPROFILE ?? environment.UserProfile
    const programFiles = environment.PROGRAMFILES ?? environment.ProgramFiles
    const systemRoot = environment.SYSTEMROOT ?? environment.SystemRoot
    environment.PSModulePath = [
      join(userProfile, 'Documents', 'WindowsPowerShell', 'Modules'),
      join(programFiles, 'WindowsPowerShell', 'Modules'),
      join(systemRoot, 'system32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    ].join(';')
  }
  return environment
}

describe('Local Database Credential Bootstrap V1', () => {
  it('keeps production scripts on native DPAPI and out of portable plaintext storage', () => {
    const contents = productionScripts.map(scriptText).join('\n')
    const entry = scriptText('Enter-OpsDbSession.ps1')
    expect(contents).toContain('Export-Clixml')
    expect(contents).toContain('Import-Clixml')
    expect(contents).toContain(
      'Read-Host "$targetName database password" -AsSecureString',
    )
    expect(contents).not.toMatch(
      /ConvertFrom-SecureString\s+.*-(?:Key|SecureKey)/u,
    )
    expect(contents).not.toMatch(/ConvertTo-SecureString\s+.*-AsPlainText/u)
    expect(contents).not.toMatch(/PGPASSWORD\s*[:=]\s*['"][^$]/u)
    expect(contents).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED=0')
    expect(contents).not.toContain('rejectUnauthorized=false')
    expect(contents).not.toContain('sslmode=disable')
    expect(entry.indexOf('Assert-OpsDbWindows')).toBeLessThan(
      entry.indexOf('Get-OpsDbOperatorRoot'),
    )
  })

  it('does not add mutation, deployment, PLAN, or APPLY execution to session entry', () => {
    const entry = scriptText('Enter-OpsDbSession.ps1')
    const common = scriptText('OpsDbCredential.Common.ps1')
    for (const forbidden of [
      'db push',
      'db reset',
      'functions deploy',
      'vercel deploy',
      '--mode plan',
      '--mode apply',
      'APPLY_RECOVERY_IDENTITY_REBIND',
    ]) {
      expect((entry + common).toLowerCase()).not.toContain(
        forbidden.toLowerCase(),
      )
    }
    expect(common).toContain('WRITE AUTH   : NOT GRANTED')
    expect(common).toContain('APPLY AUTH   : NOT GRANTED')
  })

  it.runIf(process.platform === 'win32')(
    'passes synthetic DPAPI, target, redaction, CA, and cleanup tests in installed PowerShell engines',
    () => {
      const engines = powershellEngines()
      expect(
        engines.some(({ name }) => name === 'Windows PowerShell 5.1'),
      ).toBe(true)
      expect(engines.some(({ name }) => name.startsWith('PowerShell 7.'))).toBe(
        true,
      )

      for (const engine of engines) {
        const result = spawnSync(
          engine.executable,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(operatorDirectory, 'Test-OpsDbCredentialBootstrap.ps1'),
          ],
          {
            encoding: 'utf8',
            env: cleanWindowsPowerShellEnvironment(engine.name),
          },
        )
        expect({
          name: engine.name,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        }).toEqual({
          name: engine.name,
          status: 0,
          stdout: expect.stringContaining(
            'OPS DB CREDENTIAL BOOTSTRAP SYNTHETIC TESTS PASSED',
          ),
          stderr: '',
        })
      }
    },
    60_000,
  )

  it.runIf(process.platform !== 'win32')(
    'fails closed when the entry helper is invoked outside Windows',
    () => {
      const probe = spawnSync(
        'pwsh',
        [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          '$PSVersionTable.PSVersion.ToString()',
        ],
        {
          encoding: 'utf8',
        },
      )
      if (probe.error?.code === 'ENOENT') return
      expect(probe.status).toBe(0)

      const result = spawnSync(
        'pwsh',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(operatorDirectory, 'Enter-OpsDbSession.ps1'),
        ],
        { encoding: 'utf8' },
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('OPS_DB_WINDOWS_REQUIRED')
    },
    15_000,
  )
})
