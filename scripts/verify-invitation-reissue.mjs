#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration harness */
/**
 * Real local Supabase invitation-reissue integration verification (Task 1.4
 * round 2). Requires a running local stack (npm run db:start / db:reset) and
 * the pg driver installed once into a scratch directory:
 *
 *   mkdir -p /d/_trash_tmp/integration && cd /d/_trash_tmp/integration
 *   npm init -y && npm install pg
 *
 *   OPS_INTEGRATION_NODE_MODULES=/d/_trash_tmp/integration/node_modules \
 *     npm run db:reissue:verify
 *
 * The script drives REAL Auth Admin API calls (inviteUserByEmail), REAL mail
 * delivery into Mailpit, and REAL database RPCs with session roles/GUCs via a
 * direct pg connection. Every email address is a fictional example.com
 * address; the script NEVER prints full emails, invite links, OTPs or tokens.
 *
 * Exit code 0 = all checks passed.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const { createClient } = createRequire(join(repoRoot, 'node_modules', ''))(
  '@supabase/supabase-js',
)

const pgModulesRoot = process.env.OPS_INTEGRATION_NODE_MODULES
if (!pgModulesRoot) {
  console.error(
    'OPS_INTEGRATION_NODE_MODULES must point to a directory with the pg driver.',
  )
  process.exit(2)
}
// Accept both Windows drive paths and Git Bash /d/... style paths.
const pgRoot = pgModulesRoot.replace(/^\/([a-zA-Z])\//, (_, drive) => {
  return `${drive.toUpperCase()}:/`
})
const { Client } = createRequire(join(pgRoot, 'pg', 'package.json'))('pg')

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

const admin = createClient(apiUrl, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

const failures = []
function check(name, condition, detail = '') {
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
    // pg runs in autocommit by default; SET LOCAL only lives for the current
    // transaction, so the role + JWT claims GUC must share one transaction
    // with the business statements. Committed so reissue data persists.
    await client.query('begin')
    await client.query('set local role authenticated')
    if (subject) {
      // SET does not accept parameter placeholders; the subject is a UUID we
      // generate, so quoting it as a literal is safe here.
      const claims = JSON.stringify({
        sub: subject,
        iss: 'https://fixture-issuer.invalid',
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
const stamp = Date.now()
const ownerEmail = `reissue-owner-${stamp}@example.com`
const inviteeEmail = `reissue-invitee-${stamp}@example.com`
// Fresh random keys every run so repeated executions never collide.
const bootstrapKey = crypto.randomUUID()
const firstKey = crypto.randomUUID()
const secondKey = crypto.randomUUID()
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
    [ownerAppUserId, 'https://fixture-issuer.invalid', ownerAuthId],
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
check(
  'workspace bootstrapped',
  Boolean(workspaceId),
  `id=${workspaceId.slice(0, 8)}`,
)

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
  JSON.stringify(firstPrep),
)
const firstInvitationId = String(firstPrep?.invitation_id)

const firstInvite = await admin.auth.admin.inviteUserByEmail(inviteeEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
  data: {
    ops_workspace_invitation_id: firstInvitationId,
    ops_provider_tenant: 'https://fixture-issuer.invalid',
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
// 3. Expire the first invitation and REISSUE. expires_at is immutable by
//    design; the integration harness temporarily disables the immutability
//    trigger to age the fixture (test-environment-only, never production).
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
  JSON.stringify(secondPrep),
)
const secondInvitationId = String(secondPrep?.invitation_id)

const linkCheck = await asService(async (c) => {
  const r = await c.query(
    `select invitee_user_id::text as invitee, reissue_of_invitation_id::text as reissue_of
     from public.workspace_invitations where id = $1`,
    [secondInvitationId],
  )
  return r.rows[0]
})
check(
  'reissue keeps the original invitee_user_id',
  linkCheck?.invitee === inviteeAppUserId,
)
check(
  'reissue links to the replaced invitation',
  linkCheck?.reissue_of === firstInvitationId,
)

const replacedStatus = await asService(async (c) => {
  const r = await c.query(
    `select status::text as status, revoked_at is not null as revoked
     from public.workspace_invitations where id = $1`,
    [firstInvitationId],
  )
  return r.rows[0]
})
check(
  'replaced invitation is revoked',
  replacedStatus?.status === 'revoked' && replacedStatus?.revoked === true,
)

// Real Auth re-send to the SAME unconfirmed Auth user.
const secondInvite = await admin.auth.admin.inviteUserByEmail(inviteeEmail, {
  redirectTo: 'http://127.0.0.1:3000/activate-account',
  data: {
    ops_workspace_invitation_id: secondInvitationId,
    ops_provider_tenant: 'https://fixture-issuer.invalid',
  },
})
check('reissue Auth re-send succeeds', secondInvite.error === null)
const reissueAuthId = String(secondInvite.data?.user?.id ?? '')
check(
  'reissue re-sends to the SAME Auth user',
  Boolean(inviteeAuthId) && inviteeAuthId === reissueAuthId,
  `${inviteeAuthId.slice(0, 8)} vs ${reissueAuthId.slice(0, 8)}`,
)

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

// Second mail actually delivered to Mailpit.
const mailRes = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`)
const mailData = await mailRes.json()
const mailForInvitee = (mailData?.messages ?? []).filter((m) =>
  (m.To ?? []).some((t) => t.Address === inviteeEmail),
)
check(
  'two invitation mails were delivered',
  mailForInvitee.length === 2,
  `got ${mailForInvitee.length}`,
)
const mailSnippets = mailForInvitee
  .map((m) => `${m.Subject ?? ''} ${m.Snippet ?? ''}`)
  .join(' ')
check(
  'no secret or internal data leaked in mail summary',
  !mailSnippets.includes(secretKey),
)

// ---------------------------------------------------------------------------
// 4. Finalize (service-only), pending list and acceptance.
// ---------------------------------------------------------------------------
const finalized = await asService(async (c) => {
  const r = await c.query(
    `select public.finalize_workspace_invitation_reissue($1) as status`,
    [secondInvitationId],
  )
  return r.rows[0]?.status
})
check(
  'service finalizes the reissue to sent',
  finalized === 'sent',
  String(finalized),
)

let authenticatedFinalizeRejected = false
try {
  await withSession(ownerAuthId, async (c) => {
    await c.query(`select public.finalize_workspace_invitation_reissue($1)`, [
      secondInvitationId,
    ])
  })
} catch {
  authenticatedFinalizeRejected = true
}
check('authenticated cannot finalize', authenticatedFinalizeRejected)

const pending = await withSession(inviteeAuthId, async (c) => {
  const r = await c.query(
    `select invitation_id::text, status::text from public.list_my_pending_workspace_invitations()`,
  )
  return r.rows
})
check(
  'the invitee sees the new reissue invitation as pending',
  pending.some(
    (p) => p.invitation_id === secondInvitationId && p.status === 'sent',
  ),
  JSON.stringify(pending),
)

const accepted = await withSession(inviteeAuthId, async (c) => {
  const r = await c.query(
    `select membership_status::text, already_accepted from public.accept_workspace_invitation($1)`,
    [secondInvitationId],
  )
  return r.rows[0]
})
check(
  'accepting the reissue activates the membership',
  accepted?.membership_status === 'active',
)

let oldAcceptRejected = false
try {
  await withSession(inviteeAuthId, async (c) => {
    await c.query(`select public.accept_workspace_invitation($1)`, [
      firstInvitationId,
    ])
  })
} catch {
  oldAcceptRejected = true
}
check('the old invitation cannot be accepted', oldAcceptRejected)

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
console.log('')
if (failures.length > 0) {
  console.error(`INTEGRATION FAILED: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('INTEGRATION PASSED: real Auth reissue flow verified.')
