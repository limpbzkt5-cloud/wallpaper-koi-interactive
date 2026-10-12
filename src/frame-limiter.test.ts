import { describe, expect, it } from "vitest";
import { createFrameLimiter } from "./frame-limiter";

/** Simulates `frames` rAF ticks at `hz`; returns the indices that rendered. */
function run(hz: number, fps: number | null, frames: number, start = 1000): number[] {
  const limiter = createFrameLimiter();
  const period = 1000 / hz;
  const rendered: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    if (limiter.shouldRender(start + i * period, fps)) rendered.push(i);
  }
  return rendered;
}

function expectEvery(indices: number[], n: number): void {
  indices.forEach((index, position) => expect(index).toBe(position * n));
}

describe("frame limiter", () => {
  it("renders every 2nd frame for a 30 cap on a 60 Hz display", () => {
    const rendered = run(60, 30, 120);
    expectEvery(rendered, 2);
    expect(rendered).toHaveLength(60);
  });

  it("renders every 4th frame for a 30 cap on a 120 Hz display", () => {
    expectEvery(run(120, 30, 240), 4);
  });

  it("renders every 2nd frame for a 60 cap on a 120 Hz display", () => {
    expectEvery(run(120, 60, 240), 2);
  });

  it("renders every 3rd frame for a 20 cap on a 60 Hz display", () => {
    expectEvery(run(60, 20, 180), 3);
  });

  it("renders every frame for a 60 cap on a 60 Hz display", () => {
    expect(run(60, 60, 120)).toHaveLength(120);
  });

  it("renders every frame when native", () => {
    expect(run(60, null, 100)).toHaveLength(100);
    expect(run(144, null, 100)).toHaveLength(100);
  });

  it("does not drift over 1000 frames", () => {
    const rendered = run(60, 30, 1000);
    expectEvery(rendered, 2);
    const rendered120 = run(120, 20, 1000);
    expect(rendered120).toHaveLength(Math.ceil(1000 / 6));
    expectEvery(rendered120, 6);
  });

  it("holds the average rate on a display that does not divide evenly", () => {
    // 75 Hz with a 60 cap: 750 ticks are 10 s, expect ~600 renders.
    const rendered = run(75, 60, 750);
    expect(rendered.length).toBeGreaterThanOrEqual(598);
    expect(rendered.length).toBeLessThanOrEqual(602);
  });

  it("tolerates small timestamp jitter", () => {
    const limiter = createFrameLimiter();
    let renders = 0;
    for (let i = 0; i < 600; i += 1) {
      const jitter = (i % 3 - 1) * 0.4;
      if (limiter.shouldRender(i * (1000 / 60) + jitter, 30)) renders += 1;
    }
    expect(renders).toBe(300);
  });

  it("resets after a long gap and resumes the cadence", () => {
    const limiter = createFrameLimiter();
    const period = 1000 / 60;
    let now = 0;
    for (let i = 0; i < 10; i += 1) {
      limiter.shouldRender(now, 30);
      now += period;
    }
    now += 30_000;
    expect(limiter.shouldRender(now, 30)).toBe(true);
    const after: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      now += period;
      after.push(limiter.shouldRender(now, 30));
    }
    expect(after).toEqual([false, true, false, true, false, true]);
  });

  it("switches cap on the fly", () => {
    const limiter = createFrameLimiter();
    const period = 1000 / 60;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i += 1) results.push(limiter.shouldRender(i * period, 30));
    for (let i = 6; i < 10; i += 1) results.push(limiter.shouldRender(i * period, null));
    expect(results.slice(6)).toEqual([true, true, true, true]);
  });
});
