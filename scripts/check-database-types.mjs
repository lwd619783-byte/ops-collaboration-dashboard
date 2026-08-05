import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const generatedTypesPath = resolve(
  process.cwd(),
  'src/types/database.generated.ts',
)
const supabaseExecutable = resolve(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
)
const writeMode = process.argv.includes('--write')

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, '\n').replace(/\s*$/, '\n')
}

// `supabase gen types --local` connects to the freshly-reset local Postgres.
// A single transient connection/introspection hiccup right after
// `supabase db reset` on a cold CI runner can make the command exit non-zero
// even though the database is up (migration / tests / lint all pass against the
// same stack because they open their own stable connections). Retry a few times
// so a transient failure does not fail the gate, while always surfacing the real
// CLI stderr / exit code when it keeps failing. The gate is never lowered: a
// persistent failure still exits non-zero.
const typeArgs = [
  'gen',
  'types',
  '--lang',
  'typescript',
  '--local',
  '--schema',
  'public',
]
const maxAttempts = 3

function runGeneration() {
  return spawnSync(supabaseExecutable, typeArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
}

function sleepSync(ms) {
  // Synchronous backoff without pulling in timers; Atomics.wait is the
  // idiomatic sync sleep available in Node and is safe on the main thread.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

let generated = runGeneration()
for (
  let attempt = 2;
  attempt <= maxAttempts && (generated.error || generated.status !== 0);
  attempt += 1
) {
  process.stderr.write(
    `Database type generation attempt ${attempt - 1}/${maxAttempts} failed` +
      ` (exit ${generated.status ?? 'n/a'}); retrying after a short backoff...\n`,
  )
  sleepSync(400 * (attempt - 1))
  generated = runGeneration()
}

if (generated.error || generated.status !== 0) {
  process.stderr.write(
    'Database type generation failed. Supabase CLI reported:\n',
  )
  if (generated.stderr) process.stderr.write(generated.stderr)
  if (generated.stdout) process.stderr.write(generated.stdout)
  if (generated.error) {
    process.stderr.write(`spawn error: ${generated.error.message}\n`)
  }
  process.stderr.write(`exit code: ${generated.status ?? 'unknown'}\n`)
  process.stderr.write(
    'Ensure the local Supabase database is running (npm run db:start).\n',
  )
  process.exit(1)
}

const expected = normalizeLineEndings(generated.stdout)

if (writeMode) {
  writeFileSync(generatedTypesPath, expected, 'utf8')
  process.stdout.write(
    'Database types generated from the local migration state.\n',
  )
  process.exit(0)
}

let committed
try {
  committed = readFileSync(generatedTypesPath, 'utf8')
} catch {
  process.stderr.write(
    'Committed database types are missing. Run npm run db:types first.\n',
  )
  process.exit(1)
}

const actual = normalizeLineEndings(committed)

if (expected !== actual) {
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const firstDifference =
    expectedLines.findIndex((line, index) => line !== actualLines[index]) + 1
  process.stderr.write(
    `Database types have drifted near line ${firstDifference}. Run npm run db:types and review the generated diff.\n`,
  )
  process.exit(1)
}

process.stdout.write('Database types match the local migration state.\n')
