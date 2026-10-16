// Shared helpers for the database tests.
//
// The tests run the real migration files on PGlite — a full PostgreSQL 17
// running locally inside Node — with a small "shim" that recreates the
// Supabase pieces the migrations rely on (roles, auth.uid(), auth.users,
// realtime.messages / realtime.topic(), the realtime publication).
// Nothing here connects to Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migrationsDir = new URL('../migrations/', import.meta.url);
export const readMigration = (name) => readFileSync(new URL(name, migrationsDir), 'utf8');

export const STAGE1 = readMigration('20261016120000_secure_rooms_and_membership.sql');
export const STAGE1_ROLLBACK = readMigration('20261016120000_secure_rooms_and_membership.rollback.sql');
export const STAGE2 = readMigration('20261017120000_stage2_shared_room_features.sql');
export const STAGE2_ROLLBACK = readMigration('20261017120000_stage2_shared_room_features.rollback.sql');
export const STAGE3 = readMigration('20261018120000_stage3_host_takeover.sql');
export const STAGE3_ROLLBACK = readMigration('20261018120000_stage3_host_takeover.rollback.sql');

/** A database with every migration applied, ready for app-level tests */
export async function createMigratedDb() {
  const db = await createDb();
  for (const sql of [STAGE1, STAGE2, STAGE3]) {
    const result = await migrate(db, sql);
    if (!result.ok) throw new Error(result.error);
  }
  return db;
}

export const USERS = {
  A: 'aaaaaaaa-0000-4000-8000-000000000001',
  B: 'bbbbbbbb-0000-4000-8000-000000000002',
  C: 'cccccccc-0000-4000-8000-000000000003',
  D: 'dddddddd-0000-4000-8000-000000000004',
};
export const PROFILE = { avatar: 'https://images.unsplash.com/x.jpg', color: '#8B5CF6' };

// Supabase-like environment. "owner_role" plays Supabase's `postgres`
// role: not a superuser, but BYPASSRLS, owns the app tables, can read
// auth.users. Migrations are executed as this role.
const SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role owner_role nologin bypassrls;
  create role auth_admin nologin;

  create schema auth authorization auth_admin;
  create table auth.users (id uuid primary key);
  alter table auth.users owner to auth_admin;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role, owner_role;
  grant execute on function auth.uid() to anon, authenticated, service_role, owner_role;
  grant select on auth.users to owner_role;

  create schema realtime;
  create table realtime.messages (
    id bigserial primary key,
    topic text not null,
    extension text not null,
    payload jsonb,
    event text,
    private boolean default true,
    inserted_at timestamptz default now()
  );
  alter table realtime.messages enable row level security;
  alter table realtime.messages owner to owner_role;
  create function realtime.topic() returns text language sql stable as
    $$ select nullif(current_setting('realtime.topic', true), '') $$;
  grant usage on schema realtime to anon, authenticated, owner_role;
  grant select, insert on realtime.messages to authenticated;
  grant usage on sequence realtime.messages_id_seq to authenticated;
  grant execute on function realtime.topic() to anon, authenticated, owner_role;

  grant usage, create on schema public to anon, authenticated, service_role, owner_role;
  alter default privileges for role owner_role in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges for role owner_role in schema public grant all on functions to anon, authenticated, service_role;
  create publication supabase_realtime;
  alter publication supabase_realtime owner to owner_role;
`;

// The pre-Stage-1 schema as found by the inspection: TEXT user ids,
// RLS on with open USING (true) policies, both tables in realtime,
// and legacy rows with made-up "usr_..." ids.
function legacySchema(withKeys) {
  return `
  create table public.rooms (
    id uuid primary key default gen_random_uuid(),
    code text not null ${withKeys ? 'unique' : ''},
    name text not null,
    description text,
    host_id text not null,
    current_movie_id text,
    is_private boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table public.room_members (
    id uuid primary key default gen_random_uuid(),
    room_id uuid ${withKeys ? 'references public.rooms(id) on delete cascade' : ''},
    user_id text not null,
    name text not null,
    avatar text,
    color text,
    is_host boolean default false,
    last_seen_at timestamptz default now(),
    created_at timestamptz default now()
    ${withKeys ? ', unique (room_id, user_id)' : ''}
  );
  alter table public.rooms enable row level security;
  alter table public.room_members enable row level security;
  create policy "Allow public read rooms" on public.rooms for select using (true);
  create policy "Allow public write rooms" on public.rooms for all using (true) with check (true);
  create policy "Allow public members" on public.room_members for all using (true) with check (true);
  alter publication supabase_realtime add table public.rooms, public.room_members;

  insert into public.rooms (id, code, name, description, host_id, current_movie_id) values
    ('11111111-1111-4111-8111-111111111111', 'FILM-404', 'Legacy One', 'old', 'usr_abc_123', 'movie-1'),
    ('22222222-2222-4222-8222-222222222222', 'NEON-512', 'Legacy Two', null, 'usr_def_456', 'movie-2');
  insert into public.room_members (room_id, user_id, name, avatar, color, is_host) values
    ('11111111-1111-4111-8111-111111111111', 'usr_abc_123', 'Alex', 'x', null, true),
    ('11111111-1111-4111-8111-111111111111', 'usr_q', 'Q', null, 'red', false),
    ('11111111-1111-4111-8111-111111111111', 'usr_r', 'R', null, '#00FF00', false),
    ('22222222-2222-4222-8222-222222222222', 'usr_def_456', 'Dee', null, null, true),
    ('22222222-2222-4222-8222-222222222222', 'usr_s', 'S', null, null, false),
    ('22222222-2222-4222-8222-222222222222', 'usr_t', 'T', null, null, false);
  `;
}

// A pre-existing, overly broad Realtime policy (e.g. from a tutorial)
// that the Stage 2 migration must not delete but must neutralise for
// room channels.
const BROAD_REALTIME_POLICIES = `
  create policy "Existing broad read" on realtime.messages for select to anon, authenticated using (true);
  create policy "Existing broad write" on realtime.messages for insert to anon, authenticated with check (true);
  grant select, insert on realtime.messages to anon;
  grant usage on sequence realtime.messages_id_seq to anon;
`;

export async function createDb({ withKeys = true, broadRealtimePolicies = false, realtimeRls = true } = {}) {
  const db = new PGlite();
  await db.exec(SHIM);
  if (broadRealtimePolicies) await db.exec(BROAD_REALTIME_POLICIES);
  if (!realtimeRls) await db.exec('alter table realtime.messages disable row level security;');
  await db.exec(`set role owner_role; ${legacySchema(withKeys)} reset role;`);
  for (const id of Object.values(USERS)) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
  }
  return db;
}

/** Runs a migration file as the owner role. Returns { ok, error, notices }. */
export async function migrate(db, sql) {
  const notices = [];
  await db.query('set role owner_role');
  try {
    await db.exec(sql, { onNotice: (n) => notices.push(n.message) });
    return { ok: true, notices };
  } catch (e) {
    await db.exec('rollback').catch(() => {});
    return { ok: false, error: e.message, notices };
  } finally {
    await db.query('reset role');
  }
}

/**
 * Runs one statement the way a browser request does: as `authenticated`
 * with the given user's id in the JWT claims (or as `anon` when who=null).
 * Optionally sets the Realtime topic, like Realtime Authorization does.
 */
export async function as(db, who, sql, params = [], { topic } = {}) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who ? USERS[who] ?? who : '']);
  await db.query(`select set_config('realtime.topic', $1, false)`, [topic ?? '']);
  await db.query(who ? 'set role authenticated' : 'set role anon');
  try {
    return await db.query(sql, params);
  } finally {
    await db.query('reset role');
  }
}

/** Like `as`, but returns the error message (or null when it succeeded). */
export async function errorOf(db, who, sql, params = [], options) {
  try {
    await as(db, who, sql, params, options);
    return null;
  } catch (e) {
    return e.message;
  }
}

/** Every column of every legacy row, for "unchanged" comparisons. */
export async function legacySnapshot(db) {
  const { rows } = await db.query(`
    select (select json_agg(r order by r.id) from public.rooms r where r.host_id like 'usr_%') as rooms,
           (select json_agg(m order by m.id) from public.room_members m where m.user_id like 'usr_%') as members
  `);
  return JSON.stringify(rows[0]);
}

/** Creates a room as `who` and returns its row. */
export async function createRoom(db, who, name = 'Movie Night') {
  const { rows } = await as(db, who, 'select * from public.create_room($1, $2, $3, $4, $5, $6)',
    [name, 'movie-1', false, `User ${who}`, PROFILE.avatar, PROFILE.color]);
  return rows[0];
}

export async function joinRoom(db, who, code) {
  await as(db, who, 'select public.join_room($1, $2, $3, $4)', [code, `User ${who}`, PROFILE.avatar, PROFILE.color]);
}
