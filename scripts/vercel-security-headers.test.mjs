import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const vercelConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
)

function responseHeadersFor(source) {
  const rule = vercelConfig.headers?.find((entry) => entry.source === source)
  return Object.fromEntries(
    (rule?.headers ?? []).map(({ key, value }) => [key, value]),
  )
}

describe('Vercel browser security headers', () => {
  it('keeps the SPA fallback used by direct React Router navigation', () => {
    expect(vercelConfig.rewrites).toContainEqual({
      source: '/(.*)',
      destination: '/index.html',
    })
  })

  it('applies the reviewed baseline security headers to every route', () => {
    const headers = responseHeadersFor('/(.*)')

    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    )
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
    expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none')
  })

  it('does not introduce an unvalidated enforcing CSP', () => {
    const headers = responseHeadersFor('/(.*)')

    expect(headers['Content-Security-Policy']).toBeUndefined()
  })
})
