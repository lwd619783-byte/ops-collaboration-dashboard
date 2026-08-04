import { describe, expect, it } from 'vitest'
import { isSafeReturnTo, sanitizeReturnTo } from '@/features/auth/returnTo'

describe('安全 returnTo 校验', () => {
  it.each([
    '/',
    '/projects',
    '/projects/new',
    '/projects/aaaaaaaa-1111-4111-8111-111111111111',
    '/projects/aaaaaaaa-1111-4111-8111-111111111111/edit?from=list',
    '/projects?tab=active',
    '/tasks#section-1',
    '/personal?view=overview&sort=desc',
    '/members',
    '/settings',
    '/my-tasks',
    '/team-load',
    '/notifications',
  ])('接受内部路径: %s', (value) => {
    expect(isSafeReturnTo(value)).toBe(true)
  })

  it.each([
    'https://example.com',
    'http://example.com/evil',
    '//example.com',
    '//evil.example/path',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https:example.com',
    '/\\evil.example/path',
    '/\\evil',
    '\\evil',
    'evil.example',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/login?returnTo=/projects',
    '/projects/../../admin',
    '/projects/not-a-uuid',
    '/projects/aaaaaaaa-1111-0111-8111-111111111111',
    '/projects/aaaaaaaa-1111-4111-7111-111111111111/edit',
    '/projects/aaaaaaaa-1111-4111-8111-111111111111/delete',
    '/projects%0a%0d',
    ' /projects',
    '',
    '/login?returnTo=/projects',
    '//localhost/path',
  ])('拒绝非法值: %j', (value) => {
    expect(isSafeReturnTo(value)).toBe(false)
  })

  it('sanitizeReturnTo 对合法值原样返回', () => {
    expect(sanitizeReturnTo('/projects?tab=active')).toBe(
      '/projects?tab=active',
    )
    expect(sanitizeReturnTo('/')).toBe('/')
  })

  it('sanitizeReturnTo 对非法值统一回退到 /', () => {
    expect(sanitizeReturnTo('https://evil.example')).toBe('/')
    expect(sanitizeReturnTo('//evil.example')).toBe('/')
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/')
    expect(sanitizeReturnTo('/login')).toBe('/')
    expect(sanitizeReturnTo('/reset-password')).toBe('/')
    expect(sanitizeReturnTo(null)).toBe('/')
    expect(sanitizeReturnTo(undefined)).toBe('/')
    expect(sanitizeReturnTo('')).toBe('/')
  })
})
