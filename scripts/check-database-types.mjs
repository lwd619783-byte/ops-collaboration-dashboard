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

const generated = spawnSync(
  supabaseExecutable,
  ['gen', 'types', '--lang', 'typescript', '--local', '--schema', 'public'],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  },
)

if (generated.error || generated.status !== 0) {
  process.stderr.write(
    'Database type generation failed. Ensure the local Supabase database is running.\n',
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
