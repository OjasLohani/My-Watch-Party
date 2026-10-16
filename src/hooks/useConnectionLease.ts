import { useEffect, useRef } from 'react';
import { startBackgroundTicker } from '../lib/backgroundTicker';
import { LEASE_RENEW_MS } from '../lib/hostLease';

interface LeaseActions {
  /** Renews this member's lease on the server */
  renew: (roomCode: string) => Promise<unknown>;
  /** Best-effort renewal while the page is unloading (keepalive request) */
  renewOnExit: (roomCode: string) => void;
}

/**
 * Keeps this member's server-side connection lease alive while they are
 * in the room. If renewals stop for 12 s (closed tab, crash, lost
 * connection) the server treats them as disconnected; if they were the
 * host, hosting passes to a connected member.
 *
 * - Renews every 4 s from a Web Worker clock, so background tabs keep
 *   their lease.
 * - Renews immediately on entering, on returning to the tab and when
 *   the network comes back.
 * - On page unload (refresh or close) it sends one last renewal: a
 *   refresh then has the full 12 s to come back. This is best effort;
 *   correctness never depends on it.
 */
export function useConnectionLease(roomCode: string | null, actions: LeaseActions) {
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    if (!roomCode) return;
    let inFlight = false;
    let stopped = false;

    const renew = () => {
      if (inFlight || stopped) return; // never pile up slow requests
      inFlight = true;
      void actionsRef.current.renew(roomCode).finally(() => {
        inFlight = false;
      });
    };

    renew();
    const stopTicker = startBackgroundTicker(LEASE_RENEW_MS, renew);
    const onVisible = () => {
      if (document.visibilityState === 'visible') renew();
    };
    const onExit = () => actionsRef.current.renewOnExit(roomCode);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', renew);
    window.addEventListener('pagehide', onExit);

    return () => {
      stopped = true;
      stopTicker();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', renew);
      window.removeEventListener('pagehide', onExit);
    };
  }, [roomCode]);
}
