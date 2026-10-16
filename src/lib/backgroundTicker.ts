/**
 * Calls `onTick` every `intervalMs`, also while the tab is in the
 * background. Browsers slow ordinary timers in hidden tabs down to about
 * once a minute; timers inside a Web Worker keep their pace, so the
 * worker only counts time and wakes the page up.
 *
 * Falls back to setInterval if workers are unavailable (e.g. blocked).
 * Returns a function that stops the ticker.
 */
export function startBackgroundTicker(intervalMs: number, onTick: () => void): () => void {
  try {
    const source = `const id = setInterval(() => postMessage(0), ${Math.max(250, Math.floor(intervalMs))});
onmessage = () => clearInterval(id);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => onTick();
    return () => {
      worker.postMessage('stop');
      worker.terminate();
    };
  } catch {
    const id = setInterval(onTick, intervalMs);
    return () => clearInterval(id);
  }
}
