/**
 * Safe in-app "return to" path validation.
 *
 * After login we redirect the user back to the page they originally wanted.
 * That value comes from the URL / router state and must NEVER be trusted as-is:
 * it could be an open redirect (https://evil.example), a protocol-relative URL
 * (//evil.example), a dangerous scheme (javascript:) or an auth-page loop.
 *
 * Only app-internal, known business paths (with their query string and hash)
 * are allowed. Anything else falls back to `/`.
 */

import {
  appNavigation,
  legacyBusinessPathRedirects,
} from '@/app/navigation/appNavigation'

/**
 * Known business paths that a user may be returned to after login.
 * Built solely from the app navigation (including the canonical `/tasks`
 * route) plus the legacy protected redirect SOURCES so that a login flow
 * triggered from an old `/my-tasks` link still returns inside the app.
 */
const businessPaths = new Set<string>([
  '/',
  ...appNavigation
    .filter((item) => item.path !== '/system-health')
    .map((item) => item.path),
  ...legacyBusinessPathRedirects.map((item) => item.from),
  '/activate-account',
  '/projects/new',
])

/** Public auth paths that would create a redirect loop and are never valid return targets. */
const authPaths = new Set<string>([
  '/login',
  '/forgot-password',
  '/reset-password',
])

const MAX_RETURN_TO_LENGTH = 2048
const uuidSegment =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

/**
 * Dynamic protected routes that are safe return targets.
 *
 * Keep this deliberately closed over the routes that AppRouter actually
 * exposes. In particular, do not accept arbitrary suffixes after a project or
 * task id: the return target originates from browser/router state and remains
 * an untrusted redirect input even though it must start with `/`.
 */
const projectScopedBusinessPath = new RegExp(
  `^/projects/${uuidSegment}(?:/edit|/members|/tasks(?:/new|/${uuidSegment}(?:/edit)?)?)?$`,
  'iu',
)

/**
 * Split `/path?query#hash` into its pathname part. Returns the leading `/path`
 * (without query/hash) or null for malformed input.
 */
function extractPathname(value: string): string | null {
  const queryIndex = value.indexOf('?')
  const hashIndex = value.indexOf('#')
  const firstBreak = [queryIndex, hashIndex].filter((index) => index >= 0)
  const end = firstBreak.length === 0 ? value.length : Math.min(...firstBreak)
  const pathname = value.slice(0, end)
  if (!pathname.startsWith('/')) return null
  return pathname
}

/**
 * True only for a safe in-app relative path to a known business page.
 * Rejects absolute URLs, protocol-relative URLs, dangerous schemes,
 * backslashes, NUL bytes and auth-page loops.
 */
export function isSafeReturnTo(value: string): boolean {
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return false
  if (!value.startsWith('/')) return false
  // Protocol-relative (//host) and backslash (/\host or /\\host) escapes.
  if (value.startsWith('//')) return false
  if (value.includes('\\')) return false
  if (value.includes('\0')) return false
  // `javascript:`, `http:`, `https:`, `data:` etc. cannot appear because the
  // string must start with '/', but also reject any colon inside the pathname
  // segment to be conservative about scheme-like fragments.
  const pathname = extractPathname(value)
  if (!pathname) return false
  if (pathname.includes(':')) return false
  if (authPaths.has(pathname)) return false
  return businessPaths.has(pathname) || projectScopedBusinessPath.test(pathname)
}

/** Normalize a candidate returnTo to a safe value; unsafe input → '/'. */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (typeof value !== 'string' || !isSafeReturnTo(value)) return '/'
  return value
}
