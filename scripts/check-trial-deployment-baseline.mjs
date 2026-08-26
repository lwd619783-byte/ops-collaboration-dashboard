import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import {
  safeTrialTargetError,
  stableLinkedProjectRefRelativePath,
  stableSupabaseCliVersion,
  validateTrialTarget,
} from './trial-deployment-gate.mjs'
import {
  forbiddenAmbientPgSelectors,
  forbiddenMigrationBehaviorEnvironmentKeys,
  forbiddenPersistentDatabaseEnvironmentKeys,
  safeTrialDatabaseRouteError,
  stableDevelopmentProjectEnvRelativePaths,
  stableLinkedPoolerUrlRelativePath,
  validateNoMigrationBehaviorEnvironmentOverrides,
  validateNoPersistentDatabaseRouteSelectors,
  validateTrialDatabaseRoute,
} from './trial-database-route-gate.mjs'

const repositoryRoot = process.cwd()
const historicalProjectPlanHash =
  '1221774ea5c4dd54e11e1b10ac0b137272da933328d92554abaa1c7ae9f3145a'
let checkCount = 0

function read(path) {
  return readFileSync(resolve(repositoryRoot, path), 'utf8')
}

function check(condition, message) {
  if (!condition) throw new Error('Trial baseline check failed: ' + message)
  checkCount += 1
}

function exactHeadingCount(contents, heading) {
  return contents.split(/\r?\n/u).filter((line) => line.trimEnd() === heading)
    .length
}

function sectionForExactHeading(contents, heading) {
  const lines = contents.split(/\r?\n/u)
  const headingLevel = /^#+/u.exec(heading)?.[0].length
  const start = lines.findIndex((line) => line.trimEnd() === heading)
  if (headingLevel === undefined || start < 0) return ''

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = /^(#+)\s/u.exec(lines[index])
    if (nextHeading && nextHeading[1].length <= headingLevel) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

export function validateTrialRunbookContract(contents, assert = check) {
  const requiredHeadings = [
    '## 9. Trial Web deployment',
    '### 9.1 Vercel Trial',
    '### 9.2 CloudBase Web Trial',
    '### 9.3 Common browser security-header baseline',
  ]
  for (const heading of requiredHeadings) {
    assert(
      exactHeadingCount(contents, heading) === 1,
      'runbook heading must appear exactly once: ' + heading,
    )
  }
  assert(
    exactHeadingCount(contents, '## 9. Vercel Trial deployment') === 0,
    'the obsolete Vercel-only Trial deployment heading is still present',
  )
  assert(
    !contents.includes('Historical heading compatibility marker'),
    'the obsolete Vercel-only heading compatibility marker is still present',
  )

  const environmentModel = sectionForExactHeading(
    contents,
    '## 1. Environment model',
  )
  const secretBoundaries = sectionForExactHeading(
    contents,
    '## 3. Secret boundaries',
  )
  const trialWebDeployment = sectionForExactHeading(
    contents,
    '## 9. Trial Web deployment',
  )
  const vercelTrial = sectionForExactHeading(contents, '### 9.1 Vercel Trial')
  const cloudBaseTrial = sectionForExactHeading(
    contents,
    '### 9.2 CloudBase Web Trial',
  )
  const securityHeaders = sectionForExactHeading(
    contents,
    '### 9.3 Common browser security-header baseline',
  )
  const traceability = sectionForExactHeading(
    contents,
    '## 10. Deployment version traceability',
  )
  const smokeChecklist = sectionForExactHeading(
    contents,
    '## 11. Smoke checklist',
  )
  const deferredActions = sectionForExactHeading(
    contents,
    '## 16. Explicitly deferred actions',
  )

  assert(
    environmentModel.includes('单一权威 Supabase Trial 项目') &&
      environmentModel.includes('授权 Vercel + CloudBase Web origins') &&
      environmentModel.includes('不是两套 backend'),
    'the environment model does not define one backend and two authorized Web origins',
  )
  assert(
    secretBoundaries.includes('Vercel 与 CloudBase 各自的平台配置中独立设置') &&
      secretBoundaries.includes('不能证明 CloudBase 自动继承'),
    'browser environment configuration is not independently required per platform',
  )
  assert(
    trialWebDeployment.includes('一个平台的通过证据不能自动证明另一个平台通过'),
    'platform deployment evidence can still be inherited across origins',
  )
  assert(
    vercelTrial.includes('| SPA routing |') &&
      vercelTrial.includes('| Browser env |') &&
      vercelTrial.includes('Vercel-specific deployment evidence'),
    'the Vercel Trial section lacks browser env, SPA, or provenance contracts',
  )
  assert(
    cloudBaseTrial.includes('配置两个 browser-safe Supabase 变量') &&
      cloudBaseTrial.includes('SPA fallback / rewrite') &&
      cloudBaseTrial.includes('CloudBase control-plane provenance'),
    'the CloudBase Trial section lacks browser env, SPA, or provenance contracts',
  )
  for (const header of [
    'Strict-Transport-Security',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Permitted-Cross-Domain-Policies',
  ]) {
    assert(
      securityHeaders.includes('`' + header + '`'),
      'the common per-origin security-header baseline is missing: ' + header,
    )
  }
  assert(
    securityHeaders.includes('按 origin 分别验证') &&
      securityHeaders.includes('不得用另一 origin 的 6/6 结果覆盖'),
    'security headers are not required independently for every origin',
  )
  assert(
    traceability.includes('每个正式授权 Web origin 必须分别建立') &&
      traceability.includes('不能自动证明') &&
      traceability.includes('CloudBase 使用 CloudBase-appropriate provenance'),
    'deployment provenance is not independently traceable for every origin',
  )
  assert(
    smokeChecklist.includes('对每个正式 Web origin 分别验证') &&
      smokeChecklist.includes('SPA/deep-link fallback') &&
      smokeChecklist.includes('Auth redirect compatibility'),
    'the smoke contract does not verify SPA and Auth compatibility per origin',
  )
  assert(
    smokeChecklist.includes(
      'Site URL / default landing origin 必须执行完整 Auth 与 core E2E',
    ) && smokeChecklist.includes('对于其他正式授权 origin，至少分别完成'),
    'the smoke contract does not separate the full Site URL E2E from other-origin minimum checks',
  )
  assert(
    contents.includes('TRIAL ADMISSION NOT ADMITTED'),
    'the runbook no longer fails closed on Trial Admission',
  )
  assert(
    deferredActions.includes(
      'FOLLOW_UP_REQUIRED: Repository plan version needs V1.4 sync',
    ),
    'the required V1.4 plan sync follow-up marker is missing',
  )

  return true
}

const projectPlan = read('docs/project-construction-plan-v1.3.md')
check(
  createHash('sha256').update(projectPlan).digest('hex') ===
    historicalProjectPlanHash,
  'the historical V1.3 project plan changed unexpectedly',
)
check(
  projectPlan.includes('## 阶段 3.9：网页受控试运行准备与部署'),
  'the authoritative Stage 3.9 route is missing',
)

const runbook = read('docs/trial-deployment.md')
validateTrialRunbookContract(runbook)
const targetGate = read('scripts/trial-deployment-gate.mjs')
const routeGate = read('scripts/trial-database-route-gate.mjs')
const routeGateTest = read('scripts/trial-database-route-gate.test.mjs')
const operatorCommon = read('scripts/operator/OpsDbCredential.Common.ps1')
const operatorInitializer = read(
  'scripts/operator/Initialize-OpsDbCredentialStore.ps1',
)
for (const selector of [
  'SUPABASE_PROJECT_ID',
  'SUPABASE_WORKDIR',
  'SUPABASE_PROFILE',
]) {
  check(
    targetGate.includes('environment.' + selector),
    'the target gate does not read the ambient selector: ' + selector,
  )
  check(
    runbook.includes(selector),
    'the runbook does not document the ambient selector: ' + selector,
  )
}
check(
  runbook.includes('current repository checkout'),
  'the runbook does not require commands to use the current repository checkout',
)
check(
  runbook.includes('workdir redirect is forbidden'),
  'the runbook does not forbid ambient workdir redirects',
)
check(
  runbook.includes('non-default Supabase profile is forbidden'),
  'the runbook does not forbid non-default Supabase profiles',
)
check(
  targetGate.includes("supabaseProfile !== 'supabase'"),
  'the target gate does not require the exact built-in Supabase profile',
)
check(
  runbook.includes('`~/.supabase/profile`'),
  'the persisted Supabase profile fallback is not documented',
)
check(
  runbook.includes("$env:SUPABASE_PROFILE = 'supabase'"),
  'the runbook does not pin the built-in Supabase profile',
)
check(
  runbook.includes('不得向 Trial 命令增加 `--profile`'),
  'the runbook does not forbid profile flag overrides',
)
check(
  runbook.includes('不读取、不删除或修改用户级 `~/.supabase/profile`'),
  'the runbook does not preserve the user-level profile boundary',
)
for (const heading of [
  '## 1. Environment model',
  '## 2. Preconditions',
  '## 3. Secret boundaries',
  '## 4. Trial target gate',
  '## 5. Supabase Trial setup',
  '## 6. Migration deployment',
  '## 7. Database post-deploy verification',
  '## 8. Edge Function deployment',
  '## 9. Trial Web deployment',
  '## 10. Deployment version traceability',
  '## 11. Smoke checklist',
  '## 12. Rollback',
  '## 13. Backup and recovery boundary',
  '## 14. Incident handling',
  '## 15. Trial issue classification',
  '## 16. Explicitly deferred actions',
]) {
  check(runbook.includes(heading), 'runbook heading is missing: ' + heading)
}
for (const statusContract of [
  'TRIAL DEPLOYMENT COMPLETE',
  'RECOVERY DRILL COMPLETE',
  'FINAL TRIAL SMOKE/E2E EXECUTED — FAIL',
  'TRIAL ADMISSION NOT ADMITTED',
  'PRODUCTION NOT CONFIGURED',
]) {
  check(
    runbook.includes(statusContract),
    'the current runbook status contract is missing: ' + statusContract,
  )
}
check(
  runbook.includes('Task 3.9.1 historical baseline statement'),
  'the Task 3.9.1 historical baseline statement is not marked as historical',
)
check(
  runbook.includes('Supabase CLI 2.110.0 stable channel'),
  'the audited stable CLI channel is not documented',
)
check(
  runbook.includes('`supabase/.temp/project-ref`') &&
    runbook.includes('`.supabase/project.json`') &&
    runbook.includes('next/alpha'),
  'the stable and next/alpha linked-state contracts are not distinguished',
)
check(
  runbook.includes('`SUPABASE_PROJECT_ID`'),
  'the stable CLI environment override is not documented',
)
check(
  stableLinkedPoolerUrlRelativePath.join('/') === 'supabase/.temp/pooler-url',
  'the route gate is not pinned to the stable linked pooler metadata path',
)
for (const contract of [
  'Shared Supavisor Session Pooler',
  '5432',
  'SUPABASE_TRIAL_DB_URL',
  'PGPASSWORD',
  'passwordless',
  'sslmode=require',
  'Transaction Pooler / 6543',
  'Supabase CLI 2.110.0 stable channel',
  'SUPABASE_ENV',
  'SUPABASE_YES',
  'SUPABASE_DB_MIGRATIONS_ENABLED',
  '`.env.development.local`',
  'unrelated `VITE_*`',
]) {
  check(
    runbook.includes(contract),
    'the database route contract is not documented: ' + contract,
  )
}
for (const behaviorVariable of forbiddenMigrationBehaviorEnvironmentKeys) {
  check(
    runbook.includes(behaviorVariable) &&
      operatorCommon.includes(`'${behaviorVariable}'`),
    'the credential bootstrap does not clear a migration behavior environment override',
  )
}
for (const contract of [
  'Local Database Credential Bootstrap V1',
  'CurrentUser + CurrentMachine DPAPI',
  'OPS_DB_PRODUCTION_AUTOLOAD_DENIED',
  'OPS DATABASE SESSION CLEARED',
  'WRITE AUTH   : NOT GRANTED',
  'APPLY AUTH   : NOT GRANTED',
]) {
  check(
    runbook.includes(contract) || operatorCommon.includes(contract),
    'the local credential bootstrap contract is missing: ' + contract,
  )
}
check(
  operatorInitializer.includes('-AsSecureString') &&
    operatorInitializer.includes('Export-OpsDbSecureString'),
  'the credential initializer does not use the native SecureString DPAPI path',
)
check(
  routeGate.includes('validateTrialTarget') &&
    routeGate.includes('readLinkedProjectRef'),
  'the database route gate does not reuse the target identity gate',
)
check(
  routeGate.includes('environment.SUPABASE_TRIAL_DB_URL') &&
    routeGate.includes('environment.PGPASSWORD') &&
    routeGate.includes('environment.SUPABASE_DB_PASSWORD'),
  'the database route gate does not enforce the operator credential contract',
)
check(
  routeGateTest.includes('forbiddenAmbientPgSelectors') &&
    routeGateTest.includes('fictional-password'),
  'the database route gate lacks selector and redaction coverage',
)
const migrationCommandLines = runbook
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) =>
    /^npx supabase (?:migration list|db push(?:\s|$))/u.test(line),
  )
check(
  migrationCommandLines.length >= 4 &&
    migrationCommandLines.every(
      (line) =>
        line.includes('--db-url $env:SUPABASE_TRIAL_DB_URL') &&
        !line.includes('--linked'),
    ),
  'migration command examples must use the validated Session Pooler db-url',
)

const environmentExample = read('.env.example')
const environmentNames = environmentExample
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('=', 1)[0])
check(
  environmentNames.every((name) =>
    [
      'VITE_APP_NAME',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ].includes(name),
  ),
  '.env.example contains an unapproved browser variable',
)
check(
  environmentExample.includes('https://your-project-ref.supabase.co') &&
    environmentExample.includes('sb_publishable_your-key'),
  '.env.example must keep obvious placeholders',
)
check(
  !/(sb_secret_|service_role|BEGIN PRIVATE KEY|postgres(?:ql)?:\/\/)/iu.test(
    environmentExample,
  ),
  '.env.example contains a forbidden credential shape',
)
for (const operatorVariable of [
  'SUPABASE_TRIAL_DB_URL',
  'PGPASSWORD',
  'SUPABASE_DB_PASSWORD',
]) {
  check(
    !environmentNames.includes(operatorVariable),
    '.env.example contains a server-side operator variable',
  )
}

const packageJson = JSON.parse(read('package.json'))
const packageLock = JSON.parse(read('package-lock.json'))
check(
  packageJson.devDependencies.supabase === stableSupabaseCliVersion &&
    packageLock.packages['node_modules/supabase'].version ===
      stableSupabaseCliVersion,
  'the audited Supabase CLI version is not locked consistently',
)
check(
  stableLinkedProjectRefRelativePath.join('/') === 'supabase/.temp/project-ref',
  'the target gate is not pinned to the stable CLI linked-state path',
)
check(
  packageJson.scripts['trial:target:check'] ===
    'node scripts/trial-deployment-gate.mjs',
  'trial target script is missing',
)
check(
  packageJson.scripts['trial:db-route:check'] ===
    'node scripts/trial-database-route-gate.mjs',
  'trial database route script is missing',
)
check(
  packageJson.scripts['trial:baseline:check'] ===
    'node scripts/check-trial-deployment-baseline.mjs',
  'trial baseline script is missing',
)
check(
  packageJson.scripts['operator:db-credentials:verify'] ===
    'vitest run scripts/operator/ops-db-credential-bootstrap.test.mjs',
  'operator credential bootstrap verification script is missing',
)
check(
  packageJson.scripts.check.includes('npm run trial:baseline:check'),
  'the repository check does not include the trial baseline gate',
)

const vercel = JSON.parse(read('vercel.json'))
check(
  vercel.rewrites?.some(
    (rewrite) =>
      rewrite.source === '/(.*)' && rewrite.destination === '/index.html',
  ),
  'the Vercel SPA fallback is missing',
)

const gitignore = read('.gitignore')
for (const ignoredPath of [
  '.env',
  '.env.*',
  '!.env.example',
  'supabase/.temp/',
  '.supabase/',
  '.vercel/',
]) {
  check(
    gitignore.includes(ignoredPath),
    'gitignore rule is missing: ' + ignoredPath,
  )
}

const supabaseConfig = read('supabase/config.toml')
check(
  /\[functions\.invite-workspace-member\][\s\S]*?verify_jwt\s*=\s*true/u.test(
    supabaseConfig,
  ),
  'the invitation Edge Function must keep JWT verification enabled',
)
check(
  supabaseConfig.includes('otp_expiry = 3600'),
  'the reviewed invitation OTP expiry is missing',
)

const migrations = readdirSync(
  resolve(repositoryRoot, 'supabase', 'migrations'),
)
  .filter((name) => name.endsWith('.sql'))
  .sort()
check(migrations.length > 0, 'no migrations were found')
check(
  new Set(migrations).size === migrations.length,
  'duplicate migration filenames were found',
)

let productionRejected = false
try {
  validateTrialTarget({
    target: 'production',
    confirmation: 'TRIAL',
    projectRef: 'abcdefghijklmnopqrst',
    linkedProjectRef: 'abcdefghijklmnopqrst',
  })
} catch (error) {
  productionRejected =
    error instanceof Error && error.message === safeTrialTargetError
}
check(productionRejected, 'the target gate did not reject production')

let environmentOverrideRejected = false
try {
  validateTrialTarget({
    target: 'trial',
    confirmation: 'TRIAL',
    projectRef: 'abcdefghijklmnopqrst',
    linkedProjectRef: 'abcdefghijklmnopqrst',
    supabaseProjectId: 'zyxwvutsrqponmlkjihg',
    supabaseProfile: 'supabase',
  })
} catch (error) {
  environmentOverrideRejected =
    error instanceof Error && error.message === safeTrialTargetError
}
check(
  environmentOverrideRejected,
  'the target gate did not reject a conflicting CLI environment override',
)

let pinnedProfileAccepted
try {
  pinnedProfileAccepted =
    validateTrialTarget({
      target: 'trial',
      confirmation: 'TRIAL',
      projectRef: 'abcdefghijklmnopqrst',
      linkedProjectRef: 'abcdefghijklmnopqrst',
      supabaseProfile: 'supabase',
    }).target === 'trial'
} catch {
  pinnedProfileAccepted = false
}
check(
  pinnedProfileAccepted,
  'the target gate did not accept the exact built-in Supabase profile',
)

for (const missingProfile of [undefined, '']) {
  let missingProfileRejected = false
  try {
    validateTrialTarget({
      target: 'trial',
      confirmation: 'TRIAL',
      projectRef: 'abcdefghijklmnopqrst',
      linkedProjectRef: 'abcdefghijklmnopqrst',
      supabaseProfile: missingProfile,
    })
  } catch (error) {
    missingProfileRejected =
      error instanceof Error && error.message === safeTrialTargetError
  }
  check(
    missingProfileRejected,
    'the target gate allowed persisted-profile fallback',
  )
}

for (const ambientSelector of [
  { supabaseWorkdir: 'fictional/other-checkout' },
  { supabaseProfile: 'supabase-staging' },
]) {
  let ambientSelectorRejected = false
  try {
    validateTrialTarget({
      target: 'trial',
      confirmation: 'TRIAL',
      projectRef: 'abcdefghijklmnopqrst',
      linkedProjectRef: 'abcdefghijklmnopqrst',
      supabaseProjectId: 'abcdefghijklmnopqrst',
      supabaseProfile: 'supabase',
      ...ambientSelector,
    })
  } catch (error) {
    ambientSelectorRejected =
      error instanceof Error && error.message === safeTrialTargetError
  }
  check(
    ambientSelectorRejected,
    'the target gate did not reject a non-empty ambient selector',
  )
}

check(
  forbiddenAmbientPgSelectors.join(',') ===
    [
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
    ].join(','),
  'the audited Supabase CLI 2.110.0 PG selector set changed',
)
check(
  forbiddenPersistentDatabaseEnvironmentKeys.join(',') ===
    [
      'SUPABASE_TRIAL_DB_URL',
      'SUPABASE_DB_PASSWORD',
      'PGPASSWORD',
      ...forbiddenMigrationBehaviorEnvironmentKeys,
      ...forbiddenAmbientPgSelectors,
    ].join(','),
  'the persistent database environment selector set changed',
)
check(
  forbiddenMigrationBehaviorEnvironmentKeys.join(',') ===
    ['SUPABASE_YES', 'SUPABASE_DB_MIGRATIONS_ENABLED'].join(','),
  'the migration behavior environment selector set changed',
)
check(
  stableDevelopmentProjectEnvRelativePaths
    .map((parts) => parts.join('/'))
    .join(',') ===
    [
      'supabase/.env.development.local',
      'supabase/.env.local',
      'supabase/.env.development',
      'supabase/.env',
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ].join(','),
  'the stable development project environment scan paths changed',
)

const projectEnvironmentFixture = mkdtempSync(
  join(tmpdir(), 'trial-route-baseline-'),
)
try {
  writeFileSync(
    join(projectEnvironmentFixture, '.env'),
    'VITE_APP_NAME=fixture\nUNRELATED=allowed\n',
    'utf8',
  )
  check(
    validateNoPersistentDatabaseRouteSelectors(projectEnvironmentFixture, {
      SUPABASE_ENV: 'development',
    }),
    'the project environment gate rejected unrelated assignments',
  )

  writeFileSync(
    join(projectEnvironmentFixture, '.env'),
    'UNRELATED=`fixture\nPGHOST=forbidden\n',
    'utf8',
  )
  let backtickRouteRejected = false
  try {
    validateNoPersistentDatabaseRouteSelectors(projectEnvironmentFixture, {
      SUPABASE_ENV: 'development',
    })
  } catch (error) {
    backtickRouteRejected =
      error instanceof Error && error.message === safeTrialDatabaseRouteError
  }
  check(
    backtickRouteRejected,
    'the project environment backtick regression was not rejected',
  )

  for (const assignment of [
    'PGPASSWORD=fictional-password',
    'SUPABASE_TRIAL_DB_URL=fictional-url',
    'PGSERVICE=fictional-service',
    'SUPABASE_YES=true',
    'SUPABASE_DB_MIGRATIONS_ENABLED=false',
  ]) {
    writeFileSync(
      join(projectEnvironmentFixture, '.env'),
      assignment + '\n',
      'utf8',
    )
    let rejected = false
    try {
      validateNoPersistentDatabaseRouteSelectors(projectEnvironmentFixture, {
        SUPABASE_ENV: 'development',
      })
    } catch (error) {
      rejected =
        error instanceof Error && error.message === safeTrialDatabaseRouteError
    }
    check(rejected, 'the project environment rejection contract failed')
  }

  writeFileSync(
    join(projectEnvironmentFixture, '.env'),
    'UNRELATED=allowed\n',
    'utf8',
  )
  let nonDevelopmentRejected = false
  try {
    validateNoPersistentDatabaseRouteSelectors(projectEnvironmentFixture, {
      SUPABASE_ENV: 'staging',
    })
  } catch (error) {
    nonDevelopmentRejected =
      error instanceof Error && error.message === safeTrialDatabaseRouteError
  }
  check(
    nonDevelopmentRejected,
    'the project environment gate allowed a non-development SUPABASE_ENV',
  )
} finally {
  rmSync(projectEnvironmentFixture, { recursive: true, force: true })
}

const baselineProjectRef = 'abcdefghijklmnopqrst'
const baselinePoolerHost = 'baseline-fixture.pooler.supabase.com'
const baselineLinkedPoolerUrl =
  `postgresql://postgres.${baselineProjectRef}@` +
  `${baselinePoolerHost}:5432/postgres`
const baselineRouteEnvironment = {
  SUPABASE_TRIAL_DB_URL: `${baselineLinkedPoolerUrl}?sslmode=require`,
  PGPASSWORD: 'baseline-fictional-password',
}
check(
  validateTrialDatabaseRoute({
    projectRef: baselineProjectRef,
    linkedPoolerUrl: baselineLinkedPoolerUrl,
    environment: baselineRouteEnvironment,
  }).route === 'session-pooler',
  'the valid Session Pooler baseline route was rejected',
)

for (const behaviorEnvironment of [
  { SUPABASE_YES: 'true' },
  { SUPABASE_DB_MIGRATIONS_ENABLED: 'false' },
]) {
  let behaviorOverrideRejected = false
  try {
    validateNoMigrationBehaviorEnvironmentOverrides(behaviorEnvironment)
  } catch (error) {
    behaviorOverrideRejected =
      error instanceof Error && error.message === safeTrialDatabaseRouteError
  }
  check(
    behaviorOverrideRejected,
    'the shell migration behavior override was not rejected',
  )
}

let unsafeRouteRejected = false
try {
  validateTrialDatabaseRoute({
    projectRef: baselineProjectRef,
    linkedPoolerUrl: baselineLinkedPoolerUrl,
    environment: {
      ...baselineRouteEnvironment,
      PGHOST: 'forbidden-fixture',
    },
  })
} catch (error) {
  unsafeRouteRejected =
    error instanceof Error && error.message === safeTrialDatabaseRouteError
}
check(unsafeRouteRejected, 'the route gate allowed an ambient PG selector')

process.stdout.write(
  'Trial deployment baseline checks passed (' + checkCount + ' checks).\n',
)
