// Pure frame-pacing math for the render loop. The loop keeps running on
// requestAnimationFrame; the limiter only decides whether a given rAF tick
// should simulate + draw or be skipped.

/** A gap this long means the tab was hidden or the main thread stalled. */
const MAX_CATCH_UP_MS = 250;
/** Timestamps jitter, so a frame arriving 1 ms early still counts as on time. */
const EARLY_TOLERANCE_MS = 1;

export interface FrameLimiter {
  /**
   * Call once per rAF tick. `fps` is the cap, or null for native (render every
   * tick). Returns true when this tick should render.
   */
  shouldRender(now: number, fps: number | null): boolean;
}

export function createFrameLimiter(): FrameLimiter {
  let lastRender: number | null = null;

  return {
    shouldRender(now, fps) {
      if (fps === null || lastRender === null) {
        lastRender = now;
        return true;
      }

      const interval = 1000 / fps;
      const elapsed = now - lastRender;
      if (elapsed < interval - EARLY_TOLERANCE_MS) return false;

      if (elapsed > MAX_CATCH_UP_MS) {
        lastRender = now;
      } else {
        // Advance along the ideal schedule rather than snapping to `now`, so
        // rounding and jitter never accumulate into drift.
        const steps = Math.max(1, Math.floor((elapsed + EARLY_TOLERANCE_MS) / interval));
        lastRender += steps * interval;
      }
      return true;
    },
  };
}
