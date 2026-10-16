/* eslint-disable react-refresh/only-export-components -- test page entry, never hot-reloaded */
import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { VideoPlayer } from '../../src/components/WatchRoom/VideoPlayer';
import type { PlaybackSnapshot } from '../../src/lib/playbackState';
import { mockMovies } from '../../src/mockData';
import type { Movie } from '../../src/types';

// Fake server: like set_playback, it stamps the time, bumps the version
// and sends the new state back to every player after a short delay.
const HOST_ID = 'host-user';
const GUEST_ID = 'guest-user';
const SERVER_DELAY_MS = 80;

declare global {
  interface Window {
    harness: { published: { at: number; isPlaying: boolean; position: number }[] };
  }
}
window.harness = { published: [] };

// ?src=<url> overrides the video (e.g. a local test file)
const params = new URLSearchParams(window.location.search);
const baseMovie = mockMovies[0];
const movie: Movie = params.get('src')
  ? { ...baseMovie, videoUrl: params.get('src')!, fallbackVideoUrls: [] }
  : baseMovie;

function Harness() {
  const [playback, setPlayback] = useState<PlaybackSnapshot | null>(null);

  const onHostChange = useCallback((state: { isPlaying: boolean; position: number }) => {
    window.harness.published.push({ at: performance.now(), ...state });
    setTimeout(() => {
      setPlayback((prev) => ({
        movieId: movie.id,
        isPlaying: state.isPlaying,
        position: state.position,
        rate: 1,
        updatedAtMs: Date.now(),
        version: (prev?.version ?? 0) + 1,
        updatedBy: HOST_ID,
      }));
    }, SERVER_DELAY_MS);
  }, []);

  const player = (id: string, isHost: boolean) => (
    <div id={id} style={{ width: 640, margin: 12 }}>
      <VideoPlayer
        movie={movie}
        isHost={isHost}
        room={{ id: 'room', code: 'TEST-ROOM' }}
        currentUser={{ id: isHost ? HOST_ID : GUEST_ID, name: id, isHost }}
        driftMs={0}
        onSimulateDrift={() => {}}
        sync={{ playback, clockOffsetMs: 0, onHostChange: isHost ? onHostChange : () => {} }}
      />
    </div>
  );

  return (
    <>
      {player('host', true)}
      {player('guest', false)}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
