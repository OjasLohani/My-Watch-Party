-- =====================================================================
-- Watch Party — READ-ONLY schema inspection
-- =====================================================================
-- Purpose: show what already exists in the Supabase database BEFORE we
-- write the real migration, so the migration does not clash with it.
--
-- This file contains a single SELECT statement. It only reads the
-- database catalog (the database's own description of its tables,
-- policies and functions). It does not create, change or delete anything.
--
-- It returns no passwords, keys or user data. The only data it touches
-- is a row COUNT for each table in the "public" schema.
--
-- How to run: paste the whole file into Supabase Dashboard → SQL Editor
-- → New query, then click "Run". One results table appears.
-- =====================================================================

with public_tables as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
)
select section, object, details
from (
  -- 0. Database version
  select 0 as sort, ''::text as object, 0 as sub,
         '0. postgres version'::text as section,
         version()::text as details

  -- 1a. Do the tables the app expects already exist?
  union all
  select 1, expected.name, 0, '1a. expected tables',
         case when to_regclass('public.' || expected.name) is null
              then 'MISSING' else 'EXISTS' end
  from unnest(array['rooms', 'room_members', 'playback_states']) as expected(name)

  -- 1b. Every object in the public schema, whether RLS is on, and row count
  union all
  select 2, t.relname, 0, '1b. public tables',
         case t.relkind
           when 'r' then 'table' when 'p' then 'partitioned table'
           when 'v' then 'view'  when 'm' then 'materialized view'
           else 'foreign table' end
         || ' | RLS ' || case when t.relrowsecurity then 'ON' else 'OFF' end
         || case when t.relforcerowsecurity then ' (forced)' else '' end
         || case when t.relkind in ('r', 'p')
                 then ' | rows: ' || (xpath('/row/c/text()',
                        query_to_xml(format('select count(*) as c from public.%I', t.relname),
                                     false, true, '')))[1]::text
                 else '' end
  from public_tables t

  -- 2. Columns of the tables the app uses
  union all
  select 3, c.table_name::text, c.ordinal_position::int, '2. columns',
         c.column_name || ' : ' || c.data_type
         || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end
         || coalesce(' DEFAULT ' || c.column_default, '')
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('rooms', 'room_members', 'playback_states')

  -- 3. Keys, unique rules, foreign keys and checks
  union all
  select 4, con.conrelid::regclass::text, 0, '3. constraints',
         con.conname || ' | '
         || case con.contype
              when 'p' then 'PRIMARY KEY' when 'u' then 'UNIQUE'
              when 'f' then 'FOREIGN KEY' when 'c' then 'CHECK'
              else 'EXCLUDE' end
         || ' | ' || pg_get_constraintdef(con.oid)
  from pg_constraint con
  where con.connamespace = 'public'::regnamespace
    and con.contype in ('p', 'u', 'f', 'c', 'x')

  -- 4. Indexes
  union all
  select 5, i.tablename::text, 0, '4. indexes',
         i.indexname || ' | ' || i.indexdef
  from pg_indexes i
  where i.schemaname = 'public'

  -- 5. Row Level Security policies
  union all
  select 6, p.tablename::text, 0, '5. RLS policies',
         p.policyname || ' | ' || p.cmd || ' | ' || p.permissive
         || ' | roles: ' || array_to_string(p.roles, ',')
         || coalesce(' | USING: ' || p.qual, '')
         || coalesce(' | WITH CHECK: ' || p.with_check, '')
  from pg_policies p
  where p.schemaname = 'public'

  -- 6. Custom functions in the public schema (excluding extension functions)
  union all
  select 7, f.proname::text, 0, '6. functions',
         f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')'
         || ' | returns ' || coalesce(pg_get_function_result(f.oid), '?')
         || case when f.prosecdef then ' | SECURITY DEFINER' else '' end
  from pg_proc f
  where f.pronamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_depend d where d.objid = f.oid and d.deptype = 'e'
    )

  -- 7. Triggers on public tables
  union all
  select 8, tg.tgrelid::regclass::text, 0, '7. triggers',
         pg_get_triggerdef(tg.oid)
  from pg_trigger tg
  join public_tables t on t.oid = tg.tgrelid
  where not tg.tgisinternal

  -- 8. Realtime: is the publication there, and which tables are in it?
  union all
  select 9, 'supabase_realtime', 0, '8. realtime',
         case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
              then 'publication exists' else 'publication MISSING' end
  union all
  select 9, pt.schemaname || '.' || pt.tablename, 1, '8. realtime',
         'table is in supabase_realtime'
  from pg_publication_tables pt
  where pt.pubname = 'supabase_realtime'

  -- 9. What the browser roles (anon / authenticated) may do on each table
  union all
  select 10, tp.table_name::text || ' → ' || tp.grantee::text, 0, '9. table privileges',
         string_agg(tp.privilege_type::text, ', ' order by tp.privilege_type::text)
  from information_schema.table_privileges tp
  where tp.table_schema = 'public'
    and tp.grantee in ('anon', 'authenticated')
  group by tp.table_name, tp.grantee
) as report
order by sort, object, sub, details;
