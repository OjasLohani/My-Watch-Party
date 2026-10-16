/* eslint-disable react-refresh/only-export-components -- test page entry, never hot-reloaded */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useConnectionLease } from '../../src/hooks/useConnectionLease';
import { useAutoHostTransfer } from '../../src/hooks/useAutoHostTransfer';

declare global {
  interface Window {
    dbRenew: (code: string) => Promise<void>;
    dbAsk: (code: string) => Promise<{ room?: { id: string; hostId: string } }>;
    dbExit: (code: string) => Promise<void>;
    /** Test hook: what Realtime / a resync would tell this page */
    harnessSetHost?: (hostId: string) => void;
  }
}

// ?user=<id>&room=<id>&code=<code>&host=<id>&members=<id,id,…>
const params = new URLSearchParams(window.location.search);
const me = params.get('user')!;
const roomId = params.get('room')!;
const code = params.get('code')!;
const members = (params.get('members') ?? '').split(',').map((id) => ({ id }));

function Member() {
  const [hostId, setHostId] = useState(params.get('host')!);
  useEffect(() => {
    window.harnessSetHost = setHostId;
  }, []);

  useConnectionLease(code, {
    renew: (c) => window.dbRenew(c).catch(() => {}),
    renewOnExit: (c) => {
      // Same mechanism as the app: a keepalive request that outlives the page
      void fetch(`/__lease-exit?user=${encodeURIComponent(me)}&code=${encodeURIComponent(c)}`, { method: 'POST', keepalive: true }).catch(() => {});
    },
  });

  useAutoHostTransfer({
    enabled: true,
    roomId,
    roomCode: code,
    hostId,
    myId: me,
    isHost: hostId === me,
    members,
    onlineIds: null, // no Presence in this test: pace by join order only
    ask: (c) => window.dbAsk(c),
    onHostChange: setHostId,
  });

  return <div id="state" data-host={hostId} data-me={me} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Member />
  </StrictMode>
);
