#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration harness */
/**
 * Real local Supabase invitation-reissue integration verification (Task 1.4
 * round 3). Runs against the local stack (npm run db:start / db:reset). The pg
 * driver is a regular devDependency, so after `npm ci`:
 *
 *   npm run db:reissue:verify
 *
 * Drives REAL Auth Admin calls (inviteUserByEmail), REAL mail delivery into
 * Mailpit, opens the verify link from the second mail, builds a REAL Supabase
 * session and calls the business RPCs with that session. Every email is a
 * fictional example.com address; the script NEVER prints full emails, invite
 * links, OTPs, access/refresh tokens or keys.
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

// Extract the first /auth/v1/verify link from a mail body without printing it.
function extractVerifyUrl(html, text) {
  const re = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/g
  for (const body of [text ?? '', html ?? '']) {
    const m = body.match(re)
    if (m && m.length > 0) return m[0].replace(/&amp;/g, '&')
  }
  return null
}

const stamp = Date.now()
const ownerEmail = `reissue-owner-${stamp}@example.com`
const inviteeEmail = `reissue-invitee-${stamp}@example.com`
const bootstrapKey = crypto.randomUUID()
const firstKey = crypto.randomUUID()
const secondKey = crypto.randomUUID()
const recoveryKey = crypto.randomUUID()
console.log('EMAILS:', mask(ownerEmail), mask(inviteeEmail))

// ---------------------------------------------------------------------------
// Owner: a real Auth user with a provisioned internal identity, then the
// fictional workspace bootstrapped through the real service RPC.
// ---------------------------------------------------------------------------
const ownerInvite = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
})
check('owner Auth user created', ownerInvite.error === null)
const ownerAuthId = String(ownerInvite.data?.user?.id ?? '')

const ownerAppUserId = '61000000-0000-4000-8000-0000000000aa'
await asService(async (c) => {
  await c.query('begin')
  await c.query(
    `insert into public.app_users (id, status) values ($1, 'active')
     on conflict (id) do nothing`,
    [ownerAppUserId],
  )
  await c.query(
    `insert into public.profiles (user_id, display_name) values ($1, $2)
     on conflict (user_id) do nothing`,
    [ownerAppUserId, 'Fictional Reissue Owner'],
  )
  await c.query(
    `insert into public.user_identities
       (user_id, provider, provider_tenant, provider_subject, verified_at)
     values ($1, 'supabase_auth', $2, $3, now())
     on conflict (provider, provider_tenant, provider_subject) do nothing`,
    [ownerAppUserId, issuer, ownerAuthId],
  )
  await c.query('commit')
})

const workspaceId = String(
  await asService(async (c) => {
    const r = await c.query(
      `select public.bootstrap_default_workspace($1, $2, $3) as id`,
      [ownerAppUserId, 'Fictional Reissue Workspace', bootstrapKey],
    )
    return r.rows[0]?.id
  }),
)
check('workspace bootstrapped', Boolean(workspaceId))

// ---------------------------------------------------------------------------
// 1. FIRST invite: prepare (new_auth_user_invite) then real Auth invite.
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
      workspaceId,
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

// ---------------------------------------------------------------------------
// 2. First provisioning counts: one app_user / identity / membership.
// ---------------------------------------------------------------------------
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
    [firstInvitationId, workspaceId],
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
// 3. Expire the first invitation and REISSUE with real Auth + finalize.
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
      workspaceId,
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

// finalize now verifies the Auth user ID against the invitee identity.
const finalized = await asService(async (c) => {
  const r = await c.query(
    `select public.finalize_workspace_invitation_reissue($1, $2, $3) as status`,
    [secondInvitationId, issuer, reissueAuthId],
  )
  return r.rows[0]?.status
})
check(
  'service finalizes the reissue to sent',
  finalized === 'sent',
  String(finalized),
)

// Still exactly one Auth user / internal user / identity / membership.
const authUsers = await admin.auth.admin.listUsers()
const authUsersForEmail =
  authUsers.data?.users?.filter((u) => u.email === inviteeEmail) ?? []
check('still exactly one auth.users row', authUsersForEmail.length === 1)
const countsAfter = await asService(async (c) => {
  const r = await c.query(
    `select
       (select count(*) from public.app_users where id = $1) as app_users,
       (select count(*) from public.user_identities where user_id = $1) as identities,
       (select count(*) from public.workspace_members
        where workspace_id = $2 and user_id = $1) as memberships`,
    [inviteeAppUserId, workspaceId],
  )
  return r.rows[0]
})
check(
  'reissue creates no second app_user',
  Number(countsAfter?.app_users) === 1,
)
check(
  'reissue creates no second identity',
  Number(countsAfter?.identities) === 1,
)
check(
  'reissue creates no second membership',
  Number(countsAfter?.memberships) === 1,
)

// ---------------------------------------------------------------------------
// 4. REAL mail + session verification: open the second invite mail, extract
//    the verify link, build a Supabase session and assert it is the SAME Auth
//    user. Then call the business RPCs with that real session.
// ---------------------------------------------------------------------------
const mailRes = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`)
const mailData = await mailRes.json()
const mailForInvitee = (mailData?.messages ?? []).filter((m) =>
  (m.To ?? []).some((t) => t.Address === inviteeEmail),
)
check('two invitation mails were delivered', mailForInvitee.length === 2)
// The second mail (newest) is the reissue.
const secondMail = mailForInvitee[0]
const fullMail = await fetch(
  `${mailpitUrl}/api/v1/message/${secondMail.ID}`,
).then((r) => r.json())
const verifyUrl = extractVerifyUrl(fullMail.HTML, fullMail.Text)
check('second mail contains an invite verify link', verifyUrl !== null)
let sessionTokens
try {
  sessionTokens = await readInviteSessionFromVerify(verifyUrl)
} catch {
  sessionTokens = null
}
check('verify link yields a session fragment', sessionTokens !== null)

const inviteeClient = createClient(apiUrl, status.PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
const { data: sessionData, error: sessionError } =
  await inviteeClient.auth.setSession({
    access_token: sessionTokens?.accessToken,
    refresh_token: sessionTokens?.refreshToken,
  })
check(
  'real Supabase session established from the mail link',
  sessionError === null && Boolean(sessionData?.session),
)
const { data: userData, error: userError } = await inviteeClient.auth.getUser()
check(
  'session belongs to the original Auth user',
  userError === null && userData?.user?.id === inviteeAuthId,
)

// Use the REAL session (not a hand-crafted GUC) for the business RPCs.
const { data: pending, error: pendingError } = await inviteeClient.rpc(
  'list_my_pending_workspace_invitations',
)
check(
  'the invitee sees the new reissue invitation as pending',
  pendingError === null &&
    Array.isArray(pending) &&
    pending.some(
      (p) => p.invitation_id === secondInvitationId && p.status === 'sent',
    ),
)

// The OLD invitation cannot be accepted.
const { error: oldAcceptError } = await inviteeClient.rpc(
  'accept_workspace_invitation',
  { p_invitation_id: firstInvitationId },
)
check('the old invitation cannot be accepted', oldAcceptError !== null)

// ---------------------------------------------------------------------------
// 5. Recoverable failed reissue: a fresh failed reissue lineage is recovered
//    with a new key. The prepare MUST return existing_invitee_reissue (never
//    new_auth_user_invite). Auth re-sending is not attempted here because the
//    verify link already confirmed the Auth user; the lineage rule itself is
//    the invariant under test.
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
      workspaceId,
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
      workspaceId,
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
const countsAfterRecovery = await asService(async (c) => {
  const r = await c.query(
    `select
       (select count(*) from public.app_users where id = $1) as app_users,
       (select count(*) from public.user_identities where user_id = $1) as identities,
       (select count(*) from public.workspace_members
        where workspace_id = $2 and user_id = $1) as memberships`,
    [inviteeAppUserId, workspaceId],
  )
  return r.rows[0]
})
check(
  'recovery keeps app_user count at 1',
  Number(countsAfterRecovery?.app_users) === 1,
)
check(
  'recovery keeps identity count at 1',
  Number(countsAfterRecovery?.identities) === 1,
)
check(
  'recovery keeps membership count at 1',
  Number(countsAfterRecovery?.memberships) === 1,
)

// ---------------------------------------------------------------------------
// 6. auth_user_conflict lineage: a stable conflict, no prepared row.
// ---------------------------------------------------------------------------
const conflictHash = 'dd'.repeat(32)
const conflictKey = crypto.randomUUID()
const conflictFailedId = crypto.randomUUID()
const conflictFailedKey = crypto.randomUUID()
await asService(async (c) => {
  await c.query(
    `insert into public.workspace_invitations (
       id, workspace_id, email_hash, email_hint, display_name, role, status,
       invitee_user_id, invited_by, idempotency_key, created_at, expires_at,
       sent_at, failed_at, failure_code
     ) values (
       $5, $1, $2, 'c***@e***.invalid',
       'Conflict Invitee', 'member', 'failed', $3, $4,
       $6,
       now() - interval '2 days', now() + interval '1 day',
       now() - interval '2 days', now() - interval '1 day', 'auth_user_conflict'
     )`,
    [
      workspaceId,
      conflictHash,
      inviteeAppUserId,
      ownerAppUserId,
      conflictFailedId,
      conflictFailedKey,
    ],
  )
})
let conflictRejected = false
let conflictErrorText = ''
try {
  await withSession(ownerAuthId, async (c) => {
    await c.query(
      `select * from public.prepare_workspace_invitation($1, $2, $3, $4, $5, $6)`,
      [
        workspaceId,
        conflictHash,
        'c***@e***.invalid',
        'Conflict Invitee',
        'member',
        conflictKey,
      ],
    )
  })
} catch (err) {
  conflictRejected = true
  conflictErrorText = String(err.message ?? '').split('\n')[0]
}
check(
  'an auth_user_conflict lineage returns a stable conflict',
  conflictRejected &&
    conflictErrorText === 'workspace_invitation_auth_user_conflict',
  conflictErrorText,
)
const conflictOpen = await asService(async (c) => {
  const r = await c.query(
    `select count(*)::bigint as n from public.workspace_invitations
     where workspace_id = $1 and email_hash = $2
       and status in ('prepared', 'sent', 'reissue_prepared')`,
    [workspaceId, conflictHash],
  )
  return Number(r.rows[0]?.n)
})
check(
  'auth_user_conflict never creates a new open invitation',
  conflictOpen === 0,
)

// ---------------------------------------------------------------------------
// 7. Accept the reissue invitation with the real session (membership was kept
//    invited through the recovery + conflict scenarios above) and verify the
//    final invariants.
// ---------------------------------------------------------------------------
const { data: accepted, error: acceptError } = await inviteeClient.rpc(
  'accept_workspace_invitation',
  {
    p_invitation_id: secondInvitationId,
  },
)
check(
  'accepting the reissue activates the membership',
  acceptError === null && accepted?.[0]?.membership_status === 'active',
)

// Final identity/membership invariants after acceptance.
const countsFinal = await asService(async (c) => {
  const r = await c.query(
    `select
       (select count(*) from public.app_users where id = $1) as app_users,
       (select count(*) from public.user_identities where user_id = $1) as identities,
       (select count(*) from public.workspace_members
        where workspace_id = $2 and user_id = $1) as memberships,
       (select status::text from public.workspace_members
        where workspace_id = $2 and user_id = $1) as mstatus`,
    [inviteeAppUserId, workspaceId],
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
console.log('INTEGRATION PASSED: real Auth reissue flow verified.')
