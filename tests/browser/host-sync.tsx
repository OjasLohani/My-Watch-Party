/* eslint-disable react-refresh/only-export-components -- test page entry, never hot-reloaded */
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { VideoPlayer } from '../../src/components/WatchRoom/VideoPlayer';
import type { PlaybackSnapshot } from '../../src/lib/playbackState';
import { mockMovies } from '../../src/mockData';
import type { Movie } from '../../src/types';

// Test page: the real VideoPlayer for one host and N guests, with an
// in-page fake server instead of Supabase. Like set_playback, the server
// stamps the time, bumps the version and sends the new state to every
// connected player after a short delay.
//
// URL options:  ?guests=9   number of guests (default 1)
//               ?src=<url>  play another video
//               ?player=<id>&host=<id>  "relay" mode: this page shows ONE
//                 player; the test script is the server (it receives
//                 window.relayPublish calls and sends states back through
//                 window.harness.receive). Used to simulate separate people.
// Test controls on window.harness: transferHostTo(id), setConnected(id, bool)
const SERVER_DELAY_MS = 80;

declare global {
  interface Window {
    harness: {
      published: { at: number; from: string; isPlaying: boolean; position: number }[];
      transferHostTo?: (id: string) => void;
      setConnected?: (id: string, connected: boolean) => void;
      receive?: (snapshot: PlaybackSnapshot) => void;
    };
    relayPublish?: (from: string, state: { isPlaying: boolean; position: number }) => void;
  }
}
window.harness = { published: [] };

const params = new URLSearchParams(window.location.search);
const relayPlayer = params.get('player');
const guestCount = Math.max(1, Number(params.get('guests') ?? 1));
const players = relayPlayer
  ? [relayPlayer]
  : ['host', ...Array.from({ length: guestCount }, (_, i) => (i === 0 ? 'guest' : `guest${i + 1}`))];
const baseMovie = mockMovies[0];
const movie: Movie = params.get('src')
  ? { ...baseMovie, videoUrl: params.get('src')!, fallbackVideoUrls: [] }
  : baseMovie;

function Harness() {
  const [serverPlayback, setServerPlayback] = useState<PlaybackSnapshot | null>(null);
  const [hostId, setHostId] = useState(params.get('host') ?? 'host');
  // Disconnected players keep the last state they received
  const [frozen, setFrozen] = useState<Record<string, PlaybackSnapshot | null>>({});
  const hostIdRef = useRef(hostId);
  const serverRef = useRef(serverPlayback);
  useEffect(() => {
    hostIdRef.current = hostId;
    serverRef.current = serverPlayback;
  });

  useEffect(() => {
    window.harness.receive = (snapshot) => setServerPlayback(snapshot);
    window.harness.transferHostTo = (id) => setHostId(id);
    window.harness.setConnected = (id, connected) =>
      setFrozen((prev) => {
        const next = { ...prev };
        if (connected) delete next[id];
        else next[id] = serverRef.current;
        return next;
      });
  }, []);

  const publish = useCallback((from: string, state: { isPlaying: boolean; position: number }) => {
    if (from !== hostIdRef.current) return; // the server only accepts the host
    window.harness.published.push({ at: performance.now(), from, ...state });
    if (window.relayPublish) {
      window.relayPublish(from, state); // the test script plays the server
      return;
    }
    setTimeout(() => {
      setServerPlayback((prev) => ({
        movieId: movie.id,
        isPlaying: state.isPlaying,
        position: state.position,
        rate: 1,
        updatedAtMs: Date.now(),
        version: (prev?.version ?? 0) + 1,
        updatedBy: from,
      }));
    }, SERVER_DELAY_MS);
  }, []);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {players.map((id) => {
        const isHost = id === hostId;
        const playback = Object.hasOwn(frozen, id) ? frozen[id] : serverPlayback;
        return (
          <div key={id} id={id} style={{ width: guestCount > 2 ? 320 : 640, margin: 12 }}>
            <VideoPlayer
              movie={movie}
              isHost={isHost}
              room={{ id: 'room', code: 'TEST-ROOM' }}
              currentUser={{ id, name: id, isHost }}
              driftMs={0}
              onSimulateDrift={() => {}}
              sync={{
                playback,
                clockOffsetMs: 0,
                // like the app: the fake server's delay is the measured one-way delay
                serverDelayMs: params.get('nolead') ? 0 : SERVER_DELAY_MS,
                onHostChange: (state) => publish(id, state),
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
