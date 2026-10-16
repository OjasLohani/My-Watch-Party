import { useEffect, useRef } from 'react';
import { startBackgroundTicker } from '../lib/backgroundTicker';
import { pickLikelySuccessor, shouldAskServer, TRANSFER_CHECK_TICK_MS } from '../lib/hostLease';

interface AutoHostTransferOptions {
  /** Real (Supabase) room the user is in */
  enabled: boolean;
  roomId: string;
  roomCode: string;
  hostId: string;
  myId: string;
  isHost: boolean;
  /** Members in join order */
  members: { id: string }[];
  /** Presence view (null = unknown). Only used to decide how often to ask. */
  onlineIds: Set<string> | null;
  /** Asks the server (auto_transfer_host); resolves to the room as it is now */
  ask: (roomCode: string) => Promise<{ room?: { id: string; hostId: string } }>;
  /** A different host was confirmed by the server */
  onHostChange: (hostId: string) => void;
}

/**
 * Guests periodically ask the server whether hosting should move to
 * someone else. The SERVER checks the host's connection lease and picks
 * the successor; this hook never decides anything itself. Presence only
 * sets the pace: the guest first in line asks every 3 s, the others less
 * often as backups. Runs on a Web Worker clock so background tabs keep
 * asking.
 */
export function useAutoHostTransfer(options: AutoHostTransferOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const { enabled, roomId } = options;

  useEffect(() => {
    if (!enabled) return;
    let tick = 0;
    let inFlight = false;
    return startBackgroundTicker(TRANSFER_CHECK_TICK_MS, () => {
      const o = optionsRef.current;
      tick += 1;
      if (o.isHost || inFlight || o.roomId !== roomId) return;
      const hostOnline = !o.onlineIds || o.onlineIds.has(o.hostId);
      const isLikelySuccessor = pickLikelySuccessor(o.members, o.hostId, o.onlineIds) === o.myId;
      if (!shouldAskServer(tick, { isLikelySuccessor, hostOnline })) return;

      inFlight = true;
      void o
        .ask(o.roomCode)
        .then(({ room }) => {
          const latest = optionsRef.current;
          if (room && room.id === latest.roomId && room.hostId !== latest.hostId) latest.onHostChange(room.hostId);
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    });
  }, [enabled, roomId]);
}
