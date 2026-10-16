// A small fake Supabase backend for real-browser UI tests.
//
// The app is built with VITE_SUPABASE_URL = FAKE_SUPABASE_URL; this file
// intercepts its requests in Chrome and answers like Supabase would
// (anonymous sign-in, the room RPCs, and table reads). Tests can make
// individual RPCs fail or respond slowly, and inspect every call.
// Realtime (WebSocket) is not simulated: the channel simply cannot connect.
import { randomUUID } from 'node:crypto';

export const FAKE_SUPABASE_URL = 'https://wp-test.supabase.co';
export const FAKE_ANON_KEY = 'sb_publishable_fake_for_tests';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function fakeJwt(userId) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: userId, role: 'authenticated', aud: 'authenticated', exp, is_anonymous: true })}.sig`;
}

function userFromRequest(request) {
  const auth = request.headers().authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One shared fake project. `rpcBehavior[name]` can be:
 *   'ok' (default) | 'network-error' | 'server-error' | { delayMs }
 */
export function createFakeSupabase() {
  const now = new Date().toISOString();
  const state = {
    room: {
      id: randomUUID(),
      code: 'FILM-7K3QX9',
      name: 'Friday Screening',
      description: '',
      host_id: randomUUID(), // someone else hosts unless a test changes it
      current_movie_id: 'movie-1',
      is_private: false,
      created_at: now,
      updated_at: now,
    },
    members: [],
    calls: [],
    rpcBehavior: {},
  };
  state.members.push({
    id: randomUUID(), room_id: state.room.id, user_id: state.room.host_id, name: 'Hana Host',
    avatar: '', color: '#8B5CF6', is_host: true, created_at: now, last_seen_at: now,
  });

  const rpc = {
    join_room(userId, body) {
      if (body.p_code?.toUpperCase() !== state.room.code) return [400, { message: `No room found with code "${body.p_code}".`, code: 'P0002' }];
      state.members = state.members.filter((m) => m.user_id !== userId);
      state.members.push({
        id: randomUUID(), room_id: state.room.id, user_id: userId, name: body.p_display_name,
        avatar: body.p_avatar ?? '', color: body.p_color ?? '#8B5CF6',
        is_host: state.room.host_id === userId, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
      });
      return [200, state.room];
    },
    leave_room(userId) {
      const wasHost = state.room.host_id === userId;
      state.members = state.members.filter((m) => m.user_id !== userId);
      if (wasHost && state.members.length > 0) {
        state.room.host_id = state.members[0].user_id;
        state.members = state.members.map((m) => ({ ...m, is_host: m.user_id === state.room.host_id }));
      }
      return [204, null];
    },
    renew_connection_lease: () => [204, null],
    touch_room: () => [204, null],
    auto_transfer_host: () => [200, state.room],
    server_time: () => [200, Date.now()],
    send_message: (userId, body) => [200, {
      id: Math.floor(Math.random() * 1e9), room_id: state.room.id, user_id: userId,
      user_name: state.members.find((m) => m.user_id === userId)?.name ?? 'Guest',
      user_avatar: '', user_color: '#8B5CF6', body: body.p_body, created_at: new Date().toISOString(),
    }],
  };

  const tables = {
    rooms: () => [state.room],
    room_members: () => state.members,
    room_playback: () => [],
    room_messages: () => [],
    room_playlist_items: () => [],
    room_polls: () => [],
    room_poll_votes: () => [],
  };

  /** Starts answering this page's Supabase requests */
  async function attach(page) {
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = request.url();
      // Keep tests offline and fast: no remote media or images
      if (/archive\.org|wikimedia\.org|unsplash\.com/.test(url)) return request.abort('blockedbyclient');
      if (!url.startsWith(FAKE_SUPABASE_URL)) return request.continue();

      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': request.headers()['access-control-request-headers'] ?? '*',
        'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
      };
      const respond = (status, body) =>
        request.respond({
          status,
          headers: { ...cors, 'Content-Type': 'application/json' },
          body: status === 204 || body === undefined ? '' : JSON.stringify(body),
        });

      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: cors, body: '' });

      const path = new URL(url).pathname;
      // Anonymous sign-in
      if (path === '/auth/v1/signup') {
        const id = randomUUID();
        state.calls.push({ name: 'signup', userId: id, at: Date.now() });
        return respond(200, {
          access_token: fakeJwt(id), token_type: 'bearer', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${id}`,
          user: { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, identities: [], created_at: now, updated_at: now },
        });
      }
      if (path.startsWith('/auth/v1/')) return respond(200, {});

      const userId = userFromRequest(request);
      const rpcMatch = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
      if (rpcMatch) {
        const name = rpcMatch[1];
        const body = JSON.parse(request.postData() || '{}');
        state.calls.push({ name, userId, body, at: Date.now() });
        const behavior = state.rpcBehavior[name] ?? 'ok';
        if (behavior === 'network-error') return request.abort('connectionfailed');
        if (behavior === 'server-error') return respond(500, { message: 'The server could not process the request.', code: 'XX000' });
        if (typeof behavior === 'object' && behavior.delayMs) await wait(behavior.delayMs);
        const handler = rpc[name];
        if (!handler) return respond(404, { message: `Unknown function ${name}` });
        const [status, result] = handler(userId, body);
        return respond(status, result);
      }

      const tableMatch = /^\/rest\/v1\/(\w+)$/.exec(path);
      if (tableMatch && tables[tableMatch[1]]) {
        state.calls.push({ name: `${request.method()} ${tableMatch[1]}`, userId, at: Date.now() });
        if (request.method() !== 'GET') return respond(204);
        const rows = tables[tableMatch[1]]();
        const wantsObject = (request.headers().accept ?? '').includes('vnd.pgrst.object');
        if (wantsObject) {
          return rows.length ? respond(200, rows[0]) : respond(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' });
        }
        return respond(200, rows);
      }
      return respond(404, { message: 'not faked' });
    });
  }

  const callsTo = (name, userId) => state.calls.filter((c) => c.name === name && (!userId || c.userId === userId));
  return { state, attach, callsTo };
}
