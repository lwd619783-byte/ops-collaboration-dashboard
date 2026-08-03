#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration harness */
/**
 * Real local Supabase invitation-reissue integration verification (Task 1.4
 * round 4). Runs against the local stack (npm run db:start / db:reset). The pg
 * driver is a regular devDependency, so after `npm ci`:
 *
 *   npm run db:reissue:verify
 *
 * Drives REAL Auth Admin calls (inviteUserByEmail), REAL mail delivery into
 * Mailpit, opens the recovery invite verify link, builds a REAL Supabase
 * session and calls the business RPCs with that session. Covers:
 *   - first invite + provisioning;
 *   - expired reissue with the unified confirmation RPC;
 *   - cross-workspace reuse of an unconfirmed Auth user -> safe conflict;
 *   - recoverable failed reissue -> FULL real re-send + mail + session accept;
 *   - auth_user_conflict lineage -> stable conflict;
 *   - Auth/app_user/identity/membership invariants stay at 1.
 * Every email is a fictional example.com address; the script NEVER prints
 * full emails, invite links, OTPs, access/refresh tokens or keys.
 *
 * Exit code 0 = all checks passed.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import http from 'node:http'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const requireFromRepo = createRequire(join(repoRoot, 'package.json'))
const { createClient } = requireFromRepo('@supabase/supabase-js')
const { Client } = requireFromRepo('pg')

// ---------------------------------------------------------------------------
// Local stack configuration (from `supabase status -o json`).
// ---------------------------------------------------------------------------
function localStatus() {
  const npxName =
    process.platform === 'win32'
      ? join(process.execPath, '..', 'npx.cmd')
      : 'npx'
  const result = spawnSync(npxName, ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  })
  if (result.status !== 0) {
    throw new Error(
      `supabase status failed: ${result.stderr ?? result.error?.message}`,
    )
  }
  return JSON.parse(result.stdout)
}

const status = localStatus()
const apiUrl = status.API_URL
const secretKey = status.SECRET_KEY
const dbUrl = status.DB_URL
const mailpitUrl = status.MAILPIT_URL ?? 'http://127.0.0.1:54324'
const issuer = `${apiUrl}/auth/v1`

const admin = createClient(apiUrl, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

const failures = []
let integrationChecks = 0
function check(name, condition, detail = '') {
  integrationChecks += 1
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function withSession(subject, run) {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('set local role authenticated')
    if (subject) {
      const claims = JSON.stringify({
        sub: subject,
        iss: issuer,
        role: 'authenticated',
      }).replace(/'/g, "''")
      await client.query(`set local "request.jwt.claims" = '${claims}'`)
    }
    const result = await run(client)
    await client.query('commit')
    return result
  } finally {
    await client.end()
  }
}

async function asService(run) {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

const mask = (email) => `${email.slice(0, 1)}***@${email.split('@')[1]}`

// Follow the invite verify URL WITHOUT exposing the fragment: read the 302
// Location header, parse the access/refresh tokens from it in memory.
function readInviteSessionFromVerify(verifyUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(verifyUrl, { timeout: 15000 }, (res) => {
      res.resume()
      const location = res.headers.location
      if (!location || !location.includes('#')) {
        reject(new Error('verify redirect missing session fragment'))
        return
      }
      const fragment = location.slice(location.indexOf('#') + 1)
      const params = new URLSearchParams(fragment)
      resolve({
        accessToken: params.get('access_token'),
        refreshToken: params.get('refresh_token'),
      })
    })
    req.on('error', reject)
    req.on('timeout', () => reject(new Error('verify timeout')))
  })
}

function extractVerifyUrl(html, text) {
  const re = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/g
  for (const body of [text ?? '', html ?? '']) {
    const m = body.match(re)
    if (m && m.length > 0) return m[0].replace(/&amp;/g, '&')
  }
  return null
}

async function mailFor(email) {
  const res = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`)
  const data = await res.json()
  return (data?.messages ?? []).filter((m) =>
    (m.To ?? []).some((t) => t.Address === email),
  )
}

async function mailBody(mail) {
  return fetch(`${mailpitUrl}/api/v1/message/${mail.ID}`).then((r) => r.json())
}

async function provisionOwner(authId, appUserId, displayName) {
  await asService(async (c) => {
    await c.query('begin')
    await c.query(
      `insert into public.app_users (id, status) values ($1, 'active')
       on conflict (id) do nothing`,
      [appUserId],
    )
    await c.query(
      `insert into public.profiles (user_id, display_name) values ($1, $2)
       on conflict (user_id) do nothing`,
      [appUserId, displayName],
    )
    await c.query(
      `insert into public.user_identities
         (user_id, provider, provider_tenant, provider_subject, verified_at)
       values ($1, 'supabase_auth', $2, $3, now())
       on conflict (provider, provider_tenant, provider_subject) do nothing`,
      [appUserId, issuer, authId],
    )
    await c.query('commit')
  })
}

async function bootstrapWorkspace(ownerAppUserId, name, key) {
  return String(
    await asService(async (c) => {
      const r = await c.query(
        `select public.bootstrap_default_workspace($1, $2, $3) as id`,
        [ownerAppUserId, name, key],
      )
      return r.rows[0]?.id
    }),
  )
}

const stamp = Date.now()
const ownerEmail = `reissue-owner-${stamp}@example.com`
const inviteeEmail = `reissue-invitee-${stamp}@example.com`
const ownerBEmail = `reissue-ownerb-${stamp}@example.com`
const bootstrapKey = crypto.randomUUID()
const bootstrapKeyB = crypto.randomUUID()
const firstKey = crypto.randomUUID()
const secondKey = crypto.randomUUID()
const recoveryKey = crypto.randomUUID()
const crossSpaceKey = crypto.randomUUID()
console.log('EMAILS:', mask(ownerEmail), mask(inviteeEmail), mask(ownerBEmail))

// ---------------------------------------------------------------------------
// Owner A + workspace A.
// ---------------------------------------------------------------------------
const ownerInvite = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
})
check('owner A Auth user created', ownerInvite.error === null)
const ownerAuthId = String(ownerInvite.data?.user?.id ?? '')
const ownerAppUserId = '61000000-0000-4000-8000-0000000000aa'
await provisionOwner(ownerAuthId, ownerAppUserId, 'Fictional Reissue Owner A')
const workspaceA = await bootstrapWorkspace(
  ownerAppUserId,
  'Fictional Reissue Workspace A',
  bootstrapKey,
)
check('workspace A bootstrapped', Boolean(workspaceA))

// ---------------------------------------------------------------------------
// 1. FIRST invite in A (new_auth_user_invite) then real Auth invite.
// ---------------------------------------------------------------------------
const emailHash = await (async () => {
  const bytes = new TextEncoder().encode(inviteeEmail)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
})()

const firstPrep = await withSession(ownerAuthId, async (c) => {
  const r = await c.query(
    `select invitation_id, invitation_status::text, should_send, operation_kind
     from public.prepare_workspace_invitation($1, $2, $3, $4, $5, $6)`,
    [
      workspaceA,
      emailHash,
      mask(inviteeEmail),
      'Fictional Reissue Invitee',
      'member',
      firstKey,
    ],
  )
  return r.rows[0]
})
check(
  'first prepare is a new-auth-user invite',
  firstPrep?.operation_kind === 'new_auth_user_invite' &&
    firstPrep?.invitation_status === 'prepared' &&
    firstPrep?.should_send === true,
)
const firstInvitationId = String(firstPrep?.invitation_id)

const firstInvite = await admin.auth.admin.inviteUserByEmail(inviteeEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
  data: {
    ops_workspace_invitation_id: firstInvitationId,
    ops_provider_tenant: issuer,
  },
})
check('first Auth invite succeeds', firstInvite.error === null)
const inviteeAuthId = String(firstInvite.data?.user?.id ?? '')
check('first Auth invite returns a user id', Boolean(inviteeAuthId))

// The unified confirmation RPC verifies the trigger completed provisioning.
const firstConfirm = await asService(async (c) => {
  const r = await c.query(
    `select public.confirm_workspace_auth_invitation_result($1, $2, $3, $4) as status`,
    [firstInvitationId, 'new_auth_user_invite', issuer, inviteeAuthId],
  )
  return r.rows[0]?.status
})
check(
  'new-auth confirmation succeeds after the trigger completed',
  firstConfirm === 'sent',
  String(firstConfirm),
)

const counts = await asService(async (c) => {
  const r = await c.query(
    `select
       (select count(*) from public.app_users
        where id in (select invitee_user_id from public.workspace_invitations
                     where id = $1)) as app_users,
       (select count(*) from public.user_identities
        where user_id in (select invitee_user_id from public.workspace_invitations
                          where id = $1)) as identities,
       (select count(*) from public.workspace_members
        where workspace_id = $2 and user_id in
          (select invitee_user_id from public.workspace_invitations where id = $1)) as memberships,
       (select invitee_user_id::text from public.workspace_invitations where id = $1) as invitee`,
    [firstInvitationId, workspaceA],
  )
  return r.rows[0]
})
check('first invite provisions one app_user', Number(counts?.app_users) === 1)
check('first invite provisions one identity', Number(counts?.identities) === 1)
check(
  'first invite provisions one membership',
  Number(counts?.memberships) === 1,
)
const inviteeAppUserId = String(counts?.invitee)

// ---------------------------------------------------------------------------
// 2. Expire the first invitation and REISSUE with real Auth + confirmation.
// ---------------------------------------------------------------------------
await asService(async (c) => {
  await c.query('begin')
  await c.query(
    'alter table public.workspace_invitations disable trigger workspace_invitations_immutable',
  )
  await c.query(
    `update public.workspace_invitations
     set created_at = now() - interval '2 minutes',
         expires_at = now() - interval '1 minute'
     where id = $1`,
    [firstInvitationId],
  )
  await c.query(
    'alter table public.workspace_invitations enable trigger workspace_invitations_immutable',
  )
  await c.query('commit')
})

const secondPrep = await withSession(ownerAuthId, async (c) => {
  const r = await c.query(
    `select invitation_id, invitation_status::text, should_send, operation_kind
     from public.prepare_workspace_invitation($1, $2, $3, $4, $5, $6)`,
    [
      workspaceA,
      emailHash,
      mask(inviteeEmail),
      'Fictional Reissue Invitee',
      'member',
      secondKey,
    ],
  )
  return r.rows[0]
})
check(
  'expired sent invitation returns the reissue operation',
  secondPrep?.operation_kind === 'existing_invitee_reissue' &&
    secondPrep?.invitation_status === 'reissue_prepared' &&
    secondPrep?.should_send === true,
)
const secondInvitationId = String(secondPrep?.invitation_id)

const secondInvite = await admin.auth.admin.inviteUserByEmail(inviteeEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
  data: {
    ops_workspace_invitation_id: secondInvitationId,
    ops_provider_tenant: issuer,
  },
})
check('reissue Auth re-send succeeds', secondInvite.error === null)
const reissueAuthId = String(secondInvite.data?.user?.id ?? '')
check(
  'reissue re-sends to the SAME Auth user',
  Boolean(inviteeAuthId) && inviteeAuthId === reissueAuthId,
)

// Unified confirmation with the full identity verification.
const secondConfirm = await asService(async (c) => {
  const r = await c.query(
    `select public.confirm_workspace_auth_invitation_result($1, $2, $3, $4) as status`,
    [secondInvitationId, 'existing_invitee_reissue', issuer, reissueAuthId],
  )
  return r.rows[0]?.status
})
check(
  'reissue confirmation moves the invitation to sent',
  secondConfirm === 'sent',
)

const authUsers = await admin.auth.admin.listUsers()
const authUsersForEmail =
  authUsers.data?.users?.filter((u) => u.email === inviteeEmail) ?? []
check('still exactly one auth.users row', authUsersForEmail.length === 1)

// ---------------------------------------------------------------------------
// 3. Cross-workspace reuse (BEFORE recovery so the recovery mail stays the
//    newest): workspace B first-invites the SAME unconfirmed email. B has no
//    lineage -> new_auth_user_invite; Auth reuses A's user; the unified
//    confirmation must turn B into a safe conflict.
// ---------------------------------------------------------------------------
const ownerBInvite = await admin.auth.admin.inviteUserByEmail(ownerBEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
})
check('owner B Auth user created', ownerBInvite.error === null)
const ownerBAuthId = String(ownerBInvite.data?.user?.id ?? '')
const ownerBAppUserId = '61000000-0000-4000-8000-0000000000bb'
await provisionOwner(ownerBAuthId, ownerBAppUserId, 'Fictional Reissue Owner B')
const workspaceB = await bootstrapWorkspace(
  ownerBAppUserId,
  'Fictional Reissue Workspace B',
  bootstrapKeyB,
)
check('workspace B bootstrapped', Boolean(workspaceB))

const crossPrep = await withSession(ownerBAuthId, async (c) => {
  const r = await c.query(
    `select invitation_id, invitation_status::text, should_send, operation_kind
     from public.prepare_workspace_invitation($1, $2, $3, $4, $5, $6)`,
    [
      workspaceB,
      emailHash,
      mask(inviteeEmail),
      'Cross Space Invitee',
      'member',
      crossSpaceKey,
    ],
  )
  return r.rows[0]
})
check(
  'workspace B first-invite prepares as new_auth_user_invite',
  crossPrep?.operation_kind === 'new_auth_user_invite' &&
    crossPrep?.invitation_status === 'prepared' &&
    crossPrep?.should_send === true,
  JSON.stringify(crossPrep),
)
const crossInvitationId = String(crossPrep?.invitation_id)

// Auth reuses the existing unconfirmed user (no second auth.users INSERT).
const crossInvite = await admin.auth.admin.inviteUserByEmail(inviteeEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
  data: {
    ops_workspace_invitation_id: crossInvitationId,
    ops_provider_tenant: issuer,
  },
})
check('cross-workspace Auth invite succeeds', crossInvite.error === null)
check(
  'cross-workspace Auth reuses the SAME Auth user',
  String(crossInvite.data?.user?.id ?? '') === inviteeAuthId,
)

// The unified confirmation must REFUSE to treat B as a success.
const crossConfirm = await asService(async (c) => {
  const r = await c.query(
    `select public.confirm_workspace_auth_invitation_result($1, $2, $3, $4) as status`,
    [crossInvitationId, 'new_auth_user_invite', issuer, inviteeAuthId],
  )
  return r.rows[0]?.status
})
check(
  'cross-workspace confirmation is refused as a safe conflict',
  crossConfirm === 'failed',
  String(crossConfirm),
)
const crossState = await asService(async (c) => {
  const r = await c.query(
    `select status::text as status, failure_code from public.workspace_invitations
     where id = $1`,
    [crossInvitationId],
  )
  return r.rows[0]
})
check(
  'workspace B invitation is compensated to failed/auth_user_conflict',
  crossState?.status === 'failed' &&
    crossState?.failure_code === 'auth_user_conflict',
)
const crossOpen = await asService(async (c) => {
  const r = await c.query(
    `select count(*)::bigint as n from public.workspace_invitations
     where workspace_id = $1 and email_hash = $2
       and status in ('prepared', 'sent', 'reissue_prepared')`,
    [workspaceB, emailHash],
  )
  return Number(r.rows[0]?.n)
})
check('workspace B has no open invitation left', crossOpen === 0)
const crossMembership = await asService(async (c) => {
  const r = await c.query(
    `select count(*)::bigint as n from public.workspace_members
     where workspace_id = $1 and user_id = $2`,
    [workspaceB, inviteeAppUserId],
  )
  return Number(r.rows[0]?.n)
})
check('workspace B has no membership for the invitee', crossMembership === 0)
const crossInvariants = await asService(async (c) => {
  const r = await c.query(
    `select
       (select count(*) from public.app_users where id = $1) as app_users,
       (select count(*) from public.user_identities where user_id = $1) as identities,
       (select count(*) from public.workspace_members
        where workspace_id = $2 and user_id = $1) as memberships,
       (select status::text from public.workspace_invitations where id = $3) as a_status`,
    [inviteeAppUserId, workspaceA, firstInvitationId],
  )
  return r.rows[0]
})
check(
  'cross-workspace keeps app_user count at 1',
  Number(crossInvariants?.app_users) === 1,
)
check(
  'cross-workspace keeps identity count at 1',
  Number(crossInvariants?.identities) === 1,
)
check(
  'cross-workspace keeps A membership count at 1',
  Number(crossInvariants?.memberships) === 1,
)
check(
  'workspace A invitation is untouched',
  crossInvariants?.a_status === 'revoked',
)
const crossAuthUsers = await admin.auth.admin.listUsers()
const crossAuthCount =
  crossAuthUsers.data?.users?.filter((u) => u.email === inviteeEmail) ?? []
check('Auth user count still 1', crossAuthCount.length === 1)

// ---------------------------------------------------------------------------
// 4. Recoverable failed reissue -> FULL real re-send, mail + session accept.
//    Runs AFTER the cross-workspace invite so the recovery mail is the newest
//    (the local Auth keeps the newest invite token valid). No verify link has
//    been opened yet, so the Auth user is still unconfirmed.
// ---------------------------------------------------------------------------
const recoveryHash = 'cc'.repeat(32)
const recoveryFailedId = crypto.randomUUID()
const recoveryFailedKey = crypto.randomUUID()
await asService(async (c) => {
  await c.query(
    `insert into public.workspace_invitations (
       id, workspace_id, email_hash, email_hint, display_name, role, status,
       invitee_user_id, invited_by, idempotency_key, created_at, expires_at,
       sent_at, failed_at, failure_code, reissue_of_invitation_id
     ) values (
       $6, $1, $2, 'r***@e***.invalid',
       'Recovery Invitee', 'member', 'failed', $3, $4,
       $7,
       now() - interval '2 days', now() + interval '1 day',
       now() - interval '2 days', now() - interval '1 day', 'temporary_failure',
       $5
     )`,
    [
      workspaceA,
      recoveryHash,
      inviteeAppUserId,
      ownerAppUserId,
      firstInvitationId,
      recoveryFailedId,
      recoveryFailedKey,
    ],
  )
})
const recoveryPrep = await withSession(ownerAuthId, async (c) => {
  const r = await c.query(
    `select operation_kind, invitation_status::text
     from public.prepare_workspace_invitation($1, $2, $3, $4, $5, $6)`,
    [
      workspaceA,
      recoveryHash,
      'r***@e***.invalid',
      'Recovery Invitee',
      'member',
      recoveryKey,
    ],
  )
  return r.rows[0]
})
check(
  'a recoverable failed reissue re-enters the reissue path (not new-user)',
  recoveryPrep?.operation_kind === 'existing_invitee_reissue' &&
    recoveryPrep?.invitation_status === 'reissue_prepared',
  JSON.stringify(recoveryPrep),
)
const recoveryInvitationId = await asService(async (c) => {
  const r = await c.query(
    `select id::text from public.workspace_invitations where idempotency_key = $1`,
    [recoveryKey],
  )
  return r.rows[0]?.id
})

// REAL Auth re-send for the recovery (same unconfirmed user).
const recoveryInvite = await admin.auth.admin.inviteUserByEmail(inviteeEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
  data: {
    ops_workspace_invitation_id: recoveryInvitationId,
    ops_provider_tenant: issuer,
  },
})
check('recovery Auth re-send succeeds', recoveryInvite.error === null)
check(
  'recovery re-sends to the SAME Auth user',
  String(recoveryInvite.data?.user?.id ?? '') === inviteeAuthId,
)
const recoveryConfirm = await asService(async (c) => {
  const r = await c.query(
    `select public.confirm_workspace_auth_invitation_result($1, $2, $3, $4) as status`,
    [recoveryInvitationId, 'existing_invitee_reissue', issuer, inviteeAuthId],
  )
  return r.rows[0]?.status
})
check(
  'recovery confirmation moves the invitation to sent',
  recoveryConfirm === 'sent',
)

// ---------------------------------------------------------------------------
// 5. REAL mail + session verification: open the RECOVERY mail link (the newest
//    mail for the invitee), build a real Supabase session and accept the
//    recovery invitation with it.
// ---------------------------------------------------------------------------
const recoveryMails = await mailFor(inviteeEmail)
check(
  'four invitation mails were delivered (first, reissue, cross-space, recovery)',
  recoveryMails.length === 4,
  `got ${recoveryMails.length}`,
)
// Mailpit returns newest first, so the recovery mail is the first entry.
const recoveryMail = recoveryMails[0]
const fullRecoveryMail = await mailBody(recoveryMail)
const recoveryVerifyUrl = extractVerifyUrl(
  fullRecoveryMail.HTML,
  fullRecoveryMail.Text,
)
check(
  'recovery mail contains an invite verify link',
  recoveryVerifyUrl !== null,
)
let recoveryTokens
try {
  recoveryTokens = await readInviteSessionFromVerify(recoveryVerifyUrl)
} catch {
  recoveryTokens = null
}
check('recovery verify link yields a session fragment', recoveryTokens !== null)

const inviteeClient = createClient(apiUrl, status.PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
const { data: sessionData, error: sessionError } =
  await inviteeClient.auth.setSession({
    access_token: recoveryTokens?.accessToken,
    refresh_token: recoveryTokens?.refreshToken,
  })
check(
  'real Supabase session established from the recovery mail link',
  sessionError === null && Boolean(sessionData?.session),
)
const { data: userData, error: userError } = await inviteeClient.auth.getUser()
check(
  'recovery session belongs to the original Auth user',
  userError === null && userData?.user?.id === inviteeAuthId,
)

// Use the REAL session for the business RPCs.
const { data: pending, error: pendingError } = await inviteeClient.rpc(
  'list_my_pending_workspace_invitations',
)
check(
  'the invitee sees the recovery invitation as pending',
  pendingError === null &&
    Array.isArray(pending) &&
    pending.some(
      (p) => p.invitation_id === recoveryInvitationId && p.status === 'sent',
    ),
)
const { data: accepted, error: acceptError } = await inviteeClient.rpc(
  'accept_workspace_invitation',
  { p_invitation_id: recoveryInvitationId },
)
check(
  'accepting the recovery invitation activates the membership',
  acceptError === null && accepted?.[0]?.membership_status === 'active',
)

// The OLD invitation cannot be accepted.
const { error: oldAcceptError } = await inviteeClient.rpc(
  'accept_workspace_invitation',
  { p_invitation_id: firstInvitationId },
)
check('the old invitation cannot be accepted', oldAcceptError !== null)

// Final invariants.
const countsFinal = await asService(async (c) => {
  const r = await c.query(
    `select
       (select count(*) from public.app_users where id = $1) as app_users,
       (select count(*) from public.user_identities where user_id = $1) as identities,
       (select count(*) from public.workspace_members
        where workspace_id = $2 and user_id = $1) as memberships,
       (select status::text from public.workspace_members
        where workspace_id = $2 and user_id = $1) as mstatus`,
    [inviteeAppUserId, workspaceA],
  )
  return r.rows[0]
})
check('final app_user count is 1', Number(countsFinal?.app_users) === 1)
check('final identity count is 1', Number(countsFinal?.identities) === 1)
check('final membership count is 1', Number(countsFinal?.memberships) === 1)
check('final membership is active', countsFinal?.mstatus === 'active')

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
console.log('')
console.log(`integration checks: ${integrationChecks}`)
if (failures.length > 0) {
  console.error(`INTEGRATION FAILED: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('INTEGRATION PASSED: real Auth confirmation flow verified.')
