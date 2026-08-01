import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const distPath = resolve(process.cwd(), 'dist')
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const forbiddenVariableNames = [
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_DB_URL',
  'VITE_DATABASE_URL',
  'VITE_DATABASE_PASSWORD',
  'VITE_SUPABASE_DATABASE_PASSWORD',
  'VITE_SUPABASE_JWT_SECRET',
]
const fixtureSecret = ['sb', 'secret', 'build-gate-fixture'].join('_')
const fixtureForbiddenValue = 'build-gate-forbidden-fixture'

function base64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

const fixtureServiceRoleJwt = [
  base64Url({ alg: 'HS256', typ: 'JWT' }),
  base64Url({ role: 'service_role' }),
  'fixture-signature',
].join('.')
const sensitiveFixtures = [
  fixtureSecret,
  fixtureServiceRoleJwt,
  fixtureForbiddenValue,
]

function cleanDist() {
  rmSync(distPath, { recursive: true, force: true })
}

function sanitizedEnvironment(overrides) {
  const environment = { ...process.env }

  for (const name of Object.keys(environment)) {
    if (
      name.startsWith('VITE_SUPABASE_') ||
      name.startsWith('VITE_DATABASE_')
    ) {
      delete environment[name]
    }
  }

  environment.VITE_SUPABASE_URL = ''
  environment.VITE_SUPABASE_PUBLISHABLE_KEY = ''
  for (const name of forbiddenVariableNames) environment[name] = ''

  return { ...environment, ...overrides }
}

function distContains(value) {
  if (!existsSync(distPath)) return false

  const pendingDirectories = [distPath]
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop()
    if (!directory) continue

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pendingDirectories.push(path)
      } else if (readFileSync(path).includes(Buffer.from(value, 'utf8'))) {
        return true
      }
    }
  }

  return false
}

function runBuildCase({ name, environment, shouldSucceed }) {
  cleanDist()
  const result = spawnSync(npmExecutable, ['run', 'build'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: sanitizedEnvironment(environment),
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  try {
    if (result.error) {
      throw new Error(`${name} could not start the build process.`)
    }
    if (shouldSucceed && result.status !== 0) {
      throw new Error(`${name} unexpectedly failed.`)
    }
    if (!shouldSucceed && result.status === 0) {
      throw new Error(`${name} unexpectedly succeeded.`)
    }
    if (
      !shouldSucceed &&
      !output.includes('检测到不安全或无效的 Supabase 前端配置。')
    ) {
      throw new Error(`${name} did not return the safe gate message.`)
    }
    if (sensitiveFixtures.some((value) => output.includes(value))) {
      throw new Error(`${name} exposed a credential fixture in build output.`)
    }
    if (sensitiveFixtures.some((value) => distContains(value))) {
      throw new Error(`${name} wrote a credential fixture to dist.`)
    }
    if (!shouldSucceed && existsSync(distPath)) {
      throw new Error(`${name} left a failed build artifact.`)
    }
  } finally {
    cleanDist()
  }
}

const cases = [
  {
    name: 'unconfigured build',
    environment: {},
    shouldSucceed: true,
  },
  {
    name: 'publishable build',
    environment: {
      VITE_SUPABASE_URL: 'https://build-gate.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build-gate-fixture',
    },
    shouldSucceed: true,
  },
  {
    name: 'URL-only build',
    environment: {
      VITE_SUPABASE_URL: 'https://build-gate.invalid',
    },
    shouldSucceed: false,
  },
  {
    name: 'key-only build',
    environment: {
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_build-gate-fixture',
    },
    shouldSucceed: false,
  },
  {
    name: 'secret-key build',
    environment: {
      VITE_SUPABASE_URL: 'https://build-gate.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: fixtureSecret,
    },
    shouldSucceed: false,
  },
  {
    name: 'service-role build',
    environment: {
      VITE_SUPABASE_URL: 'https://build-gate.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: fixtureServiceRoleJwt,
    },
    shouldSucceed: false,
  },
  ...forbiddenVariableNames.map((name) => ({
    name: `${name} build`,
    environment: { [name]: fixtureForbiddenValue },
    shouldSucceed: false,
  })),
]

try {
  for (const buildCase of cases) runBuildCase(buildCase)
  process.stdout.write(
    `Supabase build-time credential gate checks passed (${cases.length} cases).\n`,
  )
} finally {
  cleanDist()
}
