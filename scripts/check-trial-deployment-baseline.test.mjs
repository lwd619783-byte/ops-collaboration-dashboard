import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateTrialRunbookContract } from './check-trial-deployment-baseline.mjs'

const temporaryDirectories = []

function runbookFixture(transform = (contents) => contents) {
  const directory = mkdtempSync(join(tmpdir(), 'trial-runbook-contract-'))
  temporaryDirectories.push(directory)
  const source = readFileSync('docs/trial-deployment.md', 'utf8')
  const fixturePath = join(directory, 'trial-deployment.md')
  writeFileSync(fixturePath, transform(source), 'utf8')
  return readFileSync(fixturePath, 'utf8')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Trial deployment baseline runbook contract', () => {
  it('accepts the current structured multi-origin contract', () => {
    expect(validateTrialRunbookContract(runbookFixture())).toBe(true)
  })

  it('rejects the obsolete Vercel-only deployment heading', () => {
    const fixture = runbookFixture((contents) =>
      contents.replace(
        '## 9. Trial Web deployment',
        '## 9. Vercel Trial deployment',
      ),
    )
    expect(() => validateTrialRunbookContract(fixture)).toThrow(
      /Trial Web deployment/u,
    )
  })

  it('rejects a Vercel-only current architecture with no CloudBase section', () => {
    const fixture = runbookFixture((contents) =>
      contents.replace(
        /### 9\.2 CloudBase Web Trial[\s\S]*?(?=### 9\.3 Common browser security-header baseline)/u,
        '',
      ),
    )
    expect(() => validateTrialRunbookContract(fixture)).toThrow(
      /CloudBase Web Trial/u,
    )
  })

  it('rejects cross-origin inheritance of deployment evidence', () => {
    const fixture = runbookFixture((contents) =>
      contents.replace(
        '一个平台的通过证据不能自动证明另一个平台通过',
        '平台证据按需要复用',
      ),
    )
    expect(() => validateTrialRunbookContract(fixture)).toThrow(
      /inherited across origins/u,
    )
  })
})
