#!/usr/bin/env node
/* eslint-disable no-undef -- standalone Node integration verifier */
/**
 * Task 3.9.2-R2-F1 local old -> new identity ACL upgrade verifier.
 *
 * This script is deliberately local-only. It resets the local Supabase stack
 * to the last migration deployed to Trial, proves the historical ACL defect,
 * applies pending local migrations, verifies the canonical ACL and real SQL
 * behavior, then runs the complete pgTAP suite on the upgraded database.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const requireFromRepo = createRequire(join(repoRoot, 'package.json'))
const { Client } = requireFromRepo('pg')
const supabaseCli = join(
  repoRoot,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
)

const OLD_VERSION = '20260810180100'
const ACL_MIGRATION_VERSION = '20260812124927'
const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
]
const DANGEROUS_PRIVILEGES = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
const PROFILE_UPDATE_COLUMNS = [
  'display_name',
  'avatar_url',
  'organization_name',
  'title',
  'contact_info',
  'updated_at',
]

let checkCount = 0
const failures = []

function check(name, condition, detail = '') {
  checkCount += 1
  if (!condition) failures.push(name)
  const suffix = detail ? ` (${detail})` : ''
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${name}${suffix}`)
}

function runSupabase(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DO_NOT_TRACK: '1',
      SUPABASE_PROFILE: 'supabase',
      SUPABASE_TELEMETRY_DISABLED: '1',
    },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  })

  if (result.error || result.status !== 0) {
    if (capture) {
      if (result.stderr) process.stderr.write(result.stderr)
      if (result.stdout) process.stderr.write(result.stdout)
    }
    throw new Error(
      `Local Supabase command failed with exit ${result.status ?? 'unknown'}.`,
    )
  }
  return result.stdout ?? ''
}

function localStatus() {
  return JSON.parse(runSupabase(['status', '-o', 'json'], { capture: true }))
}

async function connect(connectionString) {
  const client = new Client({ connectionString })
  await client.connect()
  return client
}

async function migrationVersions(client) {
  const result = await client.query(
    `select version
     from supabase_migrations.schema_migrations
     order by version`,
  )
  return result.rows.map((row) => String(row.version))
}

async function tablePrivilege(client, role, table, privilege) {
  const result = await client.query(
    `select has_table_privilege(
       $1::text,
       format('public.%I', $2::text),
       $3::text
     ) as allowed`,
    [role, table, privilege],
  )
  return result.rows[0]?.allowed === true
}

async function directTablePrivileges(client, role, table) {
  const result = await client.query(
    `select coalesce(
       array_agg(x.privilege_type::text order by x.privilege_type::text)
         filter (where x.privilege_type is not null),
       array[]::text[]
     ) as privileges
     from pg_class as c
     left join lateral aclexplode(c.relacl) as x
       on x.grantee = case when $1 = 'PUBLIC' then 0 else $1::regrole::oid end
     where c.oid = format('public.%I', $2::text)::regclass`,
    [role, table],
  )
  return result.rows[0]?.privileges ?? []
}

async function profileUpdateColumns(client) {
  const result = await client.query(
    `select a.attname::text as column_name,
            has_column_privilege(
              'authenticated',
              'public.profiles',
              a.attname,
              'UPDATE'
            ) as allowed
     from pg_attribute as a
     where a.attrelid = 'public.profiles'::regclass
       and a.attnum > 0
       and not a.attisdropped
     order by a.attnum`,
  )
  return result.rows
}

async function truncateSqlstate(client, table) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`truncate table public.${table}`)
    await client.query('rollback')
    return null
  } catch (error) {
    await client.query('rollback')
    return String(error.code ?? '')
  }
}

async function assertOldDefect(client) {
  const versions = await migrationVersions(client)
  check(
    'old state ends at the Trial migration baseline',
    versions.at(-1) === OLD_VERSION,
    `migrations=${versions.length}`,
  )
  check(
    'ACL hardening migration is absent in old state',
    !versions.includes(ACL_MIGRATION_VERSION),
  )

  for (const table of ['app_users', 'profiles']) {
    for (const privilege of DANGEROUS_PRIVILEGES) {
      check(
        `pre-fix authenticated has ${privilege} on ${table}`,
        await tablePrivilege(client, 'authenticated', table, privilege),
      )
      check(
        `pre-fix anon lacks ${privilege} on ${table}`,
        !(await tablePrivilege(client, 'anon', table, privilege)),
      )
    }
  }

  check(
    'pre-fix authenticated can execute TRUNCATE profiles',
    (await truncateSqlstate(client, 'profiles')) === null,
  )
}

async function assertCanonicalAcl(client) {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['app_users', 'profiles']) {
      for (const privilege of TABLE_PRIVILEGES) {
        const expected = role === 'authenticated' && privilege === 'SELECT'
        check(
          `post-fix ${role} ${privilege} on ${table} is ${expected}`,
          (await tablePrivilege(client, role, table, privilege)) === expected,
        )
      }
    }
  }

  for (const table of ['app_users', 'profiles']) {
    const authenticated = await directTablePrivileges(
      client,
      'authenticated',
      table,
    )
    const anon = await directTablePrivileges(client, 'anon', table)
    const publicAcl = await directTablePrivileges(client, 'PUBLIC', table)
    check(
      `authenticated direct ${table} table ACL is SELECT only`,
      JSON.stringify(authenticated) === JSON.stringify(['SELECT']),
    )
    check(`anon direct ${table} table ACL is empty`, anon.length === 0)
    check(`PUBLIC direct ${table} table ACL is empty`, publicAcl.length === 0)
  }

  const columns = await profileUpdateColumns(client)
  for (const column of columns) {
    const expected = PROFILE_UPDATE_COLUMNS.includes(column.column_name)
    check(
      `profiles.${column.column_name} UPDATE is ${expected}`,
      column.allowed === expected,
    )
  }

  const dangerous = await client.query(
    `select c.relname, roles.role_name, privileges.privilege_name
     from pg_class as c
     cross join (values ('anon'::text), ('authenticated'::text)) as roles(role_name)
     cross join (
       values
         ('TRUNCATE'::text),
         ('REFERENCES'::text),
         ('TRIGGER'::text),
         ('MAINTAIN'::text)
     ) as privileges(privilege_name)
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and has_table_privilege(roles.role_name, c.oid, privileges.privilege_name)`,
  )
  check(
    'no public project table exposes a dangerous browser-role privilege',
    dangerous.rowCount === 0,
  )

  check(
    'post-fix authenticated TRUNCATE app_users is permission denied',
    (await truncateSqlstate(client, 'app_users')) === '42501',
  )
  check(
    'post-fix authenticated TRUNCATE profiles is permission denied',
    (await truncateSqlstate(client, 'profiles')) === '42501',
  )

  for (const table of ['app_users', 'profiles']) {
    const serviceRolePrivileges = await Promise.all(
      TABLE_PRIVILEGES.map((privilege) =>
        tablePrivilege(client, 'service_role', table, privilege),
      ),
    )
    check(
      `service_role ${table} core table ACL is unchanged`,
      serviceRolePrivileges.every(Boolean),
    )
  }

  for (const table of ['user_identities', 'identity_binding_challenges']) {
    check(
      `${table} remains inaccessible to anon`,
      !(await tablePrivilege(
        client,
        'anon',
        table,
        TABLE_PRIVILEGES.join(','),
      )),
    )
    check(
      `${table} remains inaccessible to authenticated`,
      !(await tablePrivilege(
        client,
        'authenticated',
        table,
        TABLE_PRIVILEGES.join(','),
      )),
    )
    check(
      `service_role retains SELECT and INSERT on ${table}`,
      (await tablePrivilege(client, 'service_role', table, 'SELECT')) &&
        (await tablePrivilege(client, 'service_role', table, 'INSERT')),
    )
    check(
      `service_role retains no DELETE on ${table}`,
      !(await tablePrivilege(client, 'service_role', table, 'DELETE')),
    )
  }
}

async function assertPositiveBusinessPath(client, issuer) {
  const userId = crypto.randomUUID()
  const otherUserId = crypto.randomUUID()
  const subject = crypto.randomUUID()

  await client.query('begin')
  try {
    await client.query(
      `insert into public.app_users (id, status)
       values ($1, 'active'), ($2, 'active')`,
      [userId, otherUserId],
    )
    await client.query(
      `insert into public.profiles (user_id, display_name)
       values ($1, 'Fictional upgrade user'), ($2, 'Fictional other user')`,
      [userId, otherUserId],
    )
    await client.query(
      `insert into public.user_identities
         (user_id, provider, provider_tenant, provider_subject, verified_at)
       values ($1, 'supabase_auth', $2, $3, now())`,
      [userId, issuer, subject],
    )
    await client.query('set local role authenticated')
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: subject, iss: issuer, role: 'authenticated' }),
    ])
    const visible = await client.query(
      `select
         (select count(*)::int from public.app_users) as users,
         (select count(*)::int from public.profiles) as profiles`,
    )
    check(
      'upgraded RLS still exposes exactly the caller core rows',
      visible.rows[0]?.users === 1 && visible.rows[0]?.profiles === 1,
    )
    const update = await client.query(
      `update public.profiles
       set display_name = 'Fictional upgraded profile',
           avatar_url = 'https://example.invalid/upgrade.png',
           organization_name = 'Fictional upgrade organization',
           title = 'Fictional upgrade title',
           contact_info = '{"channel":"fictional"}'::jsonb,
           updated_at = now()
       where user_id = $1`,
      [userId],
    )
    check(
      'upgraded database permits the six-column profile UPDATE',
      update.rowCount === 1,
    )
    await client.query('reset role')
    const stored = await client.query(
      `select display_name, avatar_url, organization_name, title, contact_info
       from public.profiles
       where user_id = $1`,
      [userId],
    )
    check(
      'owner observes the upgraded profile UPDATE result',
      stored.rows[0]?.display_name === 'Fictional upgraded profile' &&
        stored.rows[0]?.avatar_url === 'https://example.invalid/upgrade.png' &&
        stored.rows[0]?.organization_name ===
          'Fictional upgrade organization' &&
        stored.rows[0]?.title === 'Fictional upgrade title' &&
        stored.rows[0]?.contact_info?.channel === 'fictional',
    )
    await client.query('rollback')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

console.log('Identity core ACL old -> new local upgrade verification')
runSupabase(['db', 'reset', '--local', '--version', OLD_VERSION, '--no-seed'])

let status = localStatus()
let client = await connect(status.DB_URL)
let oldCount
try {
  const oldVersions = await migrationVersions(client)
  oldCount = oldVersions.length
  await assertOldDefect(client)
} finally {
  await client.end()
}

runSupabase(['migration', 'up', '--local'])

status = localStatus()
client = await connect(status.DB_URL)
try {
  const versions = await migrationVersions(client)
  check(
    'forward ACL migration is recorded after local upgrade',
    versions.includes(ACL_MIGRATION_VERSION),
  )
  check(
    'migration history remains continuous and grows forward',
    versions.length > oldCount &&
      versions.indexOf(OLD_VERSION) < versions.indexOf(ACL_MIGRATION_VERSION),
    `old=${oldCount} upgraded=${versions.length}`,
  )
  await assertCanonicalAcl(client)
  await assertPositiveBusinessPath(client, `${status.API_URL}/auth/v1`)
} finally {
  await client.end()
}

console.log('Running complete pgTAP suite on the upgraded database...')
runSupabase(['test', 'db'])

console.log('')
console.log(`identity ACL upgrade checks: ${checkCount}`)
if (failures.length > 0) {
  console.error(
    `IDENTITY ACL UPGRADE FAILED: ${failures.length} check(s) failed`,
  )
  process.exit(1)
}
console.log(
  'IDENTITY ACL UPGRADE PASSED: old defect and canonical forward fix verified.',
)
