import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  safeTrialTargetError,
  validateTrialTarget,
} from './trial-deployment-gate.mjs'

const repositoryRoot = process.cwd()
const projectPlanHash =
  '67dfa19c72092db95a2fdaab5b0ea506d16167ef2a9096907c53da4f13e3d7c5'
let checkCount = 0

function read(path) {
  return readFileSync(resolve(repositoryRoot, path), 'utf8')
}

function check(condition, message) {
  if (!condition) throw new Error('Trial baseline check failed: ' + message)
  checkCount += 1
}

const projectPlan = read('docs/project-construction-plan-v1.3.md')
check(
  createHash('sha256').update(projectPlan).digest('hex') === projectPlanHash,
  'the authoritative V1.3 project plan changed',
)
check(
  projectPlan.includes('## 阶段 3.9：网页受控试运行准备与部署'),
  'the authoritative Stage 3.9 route is missing',
)

const runbook = read('docs/trial-deployment.md')
for (const heading of [
  '## 1. Environment model',
  '## 2. Preconditions',
  '## 3. Secret boundaries',
  '## 4. Trial target gate',
  '## 5. Supabase Trial setup',
  '## 6. Migration deployment',
  '## 7. Database post-deploy verification',
  '## 8. Edge Function deployment',
  '## 9. Vercel Trial deployment',
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
check(
  runbook.includes('Remote Trial deployment has not been executed'),
  'the remote-deployment deferral is not explicit',
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

const packageJson = JSON.parse(read('package.json'))
check(
  packageJson.scripts['trial:target:check'] ===
    'node scripts/trial-deployment-gate.mjs',
  'trial target script is missing',
)
check(
  packageJson.scripts['trial:baseline:check'] ===
    'node scripts/check-trial-deployment-baseline.mjs',
  'trial baseline script is missing',
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

process.stdout.write(
  'Trial deployment baseline checks passed (' + checkCount + ' checks).\n',
)
