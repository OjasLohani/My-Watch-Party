// Checks that every RPC the frontend calls exists in a migration with
// exactly the parameter names the frontend sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const migrations = readdirSync(new URL('supabase/migrations/', root))
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql'))
  .map((f) => readFileSync(new URL(`supabase/migrations/${f}`, root), 'utf8'))
  .join('\n');

const sqlFunctions = new Map();
for (const m of migrations.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)) {
  sqlFunctions.set(m[1], [...m[2].matchAll(/\b(p_\w+)\b/g)].map((x) => x[1]).sort());
}

const sources = ['src/services/roomService.ts', 'src/services/roomFeaturesService.ts']
  .map((f) => readFileSync(new URL(f, root), 'utf8'))
  .join('\n');
const calls = [...sources.matchAll(/(?:\.rpc|simpleRpc)\(\s*'(\w+)'\s*(?:,\s*\{([^}]*)\})?\s*\)/g)]
  .map((m) => ({ name: m[1], params: [...(m[2] ?? '').matchAll(/\b(p_\w+)\s*:/g)].map((x) => x[1]).sort() }));

test('frontend RPC calls match SQL function signatures', () => {
  assert.ok(calls.length >= 14, `found ${calls.length} calls`);
  for (const call of calls) {
    assert.ok(sqlFunctions.has(call.name), `missing SQL function ${call.name}`);
    assert.deepEqual(call.params, sqlFunctions.get(call.name), `parameters of ${call.name}`);
  }
});
