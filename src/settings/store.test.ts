import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "./store";

describe("SettingsStore", () => {
  let store: SettingsStore;

  beforeEach(() => {
    store = new SettingsStore();
  });

  it("set() updates live in place and keeps object identity", () => {
    const koiBefore = store.live.koi;
    store.set(["koi", "initialCount"], 20);
    expect(store.live.koi).toBe(koiBefore);
    expect(store.live.koi.initialCount).toBe(20);
  });

  it("rejects an out-of-range or wrong-type value", () => {
    store.set(["koi", "initialCount"], "nope" as unknown as number);
    expect(store.live.koi.initialCount).toBe(14);
  });

  it("clamps koi depth ranges to 0..1 (regression: used to clamp incorrectly)", () => {
    store.set(["koi", "depth", "initialRange"], [-5, 5]);
    expect(store.live.koi.depth.initialRange).toEqual([0, 1]);
  });

  it("grows a collection when its count field increases, preserving array identity", () => {
    const schools = store.live["tiny-fish-schools"];
    expect(schools).toHaveLength(4);
    store.set(["tiny-fish", "visibleSchoolCount"], 6);
    expect(store.live["tiny-fish-schools"]).toBe(schools);
    expect(schools).toHaveLength(6);
  });

  it("undoes collection growth", () => {
    store.set(["tiny-fish", "visibleSchoolCount"], 6);
    expect(store.live["tiny-fish-schools"]).toHaveLength(6);
    store.undo();
    expect(store.live["tiny-fish-schools"]).toHaveLength(4);
    expect(store.live["tiny-fish"].visibleSchoolCount).toBe(3);
  });

  it("groups rapid edits with the same interaction key into one undo entry", () => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);
    store.set(["koi", "eyeColor"], 0x111111, { interaction: "eye" });
    now.mockReturnValue(100);
    store.set(["koi", "eyeColor"], 0x222222, { interaction: "eye" });
    now.mockReturnValue(900); // past the 550ms grouping window
    store.set(["koi", "eyeColor"], 0x333333, { interaction: "eye" });

    expect(store.live.koi.eyeColor).toBe(0x333333);
    store.undo();
    expect(store.live.koi.eyeColor).toBe(0x222222);
    store.undo();
    expect(store.live.koi.eyeColor).toBe(0x171815); // back to default
    now.mockRestore();
    vi.useRealTimers();
  });

  it("supports multi-level undo/redo", () => {
    store.set(["koi", "initialCount"], 20);
    store.set(["koi", "initialCount"], 30, { interaction: "a" });
    store.undo();
    expect(store.live.koi.initialCount).toBe(20);
    store.redo();
    expect(store.live.koi.initialCount).toBe(30);
  });

  it("setWeather drops only preset-owned overrides; later edits stick", () => {
    store.set(["koi", "shadow", "color"], 0xabcdef);
    store.set(["koi", "initialCount"], 33); // not preset-owned
    store.setWeather("moonlight");
    expect(store.live.koi.initialCount).toBe(33); // survives
    expect(store.live.koi.shadow.color).not.toBe(0xabcdef); // preset-owned, dropped

    // A later edit on a preset-owned field sticks even after this weather switch.
    store.set(["koi", "shadow", "color"], 0x123456);
    store.setWeather("sunny");
    expect(store.live.koi.shadow.color).not.toBe(0x123456); // sunny owns it too, so it's replaced by sunny's value
  });

  it("resetSections falls back to the weather value, not the bare default", () => {
    store.setWeather("moonlight");
    const weatherColor = store.live.koi.shadow.color;
    store.set(["koi", "shadow", "color"], 0xabcdef);
    expect(store.live.koi.shadow.color).toBe(0xabcdef);
    store.resetSections(["koi"]);
    expect(store.live.koi.shadow.color).toBe(weatherColor);
  });

  it("fires the koi:count effect tag with an effect-carrying change", () => {
    const batches: unknown[][] = [];
    store.subscribe((batch) => batches.push([...batch]));
    store.set(["koi", "initialCount"], 25);
    expect(batches.flat().some((c) => (c as { effect?: string }).effect === "koi:count")).toBe(true);
  });

  it("tags duckweed ripple-response edits with the no-rebuild duckweed:live effect", () => {
    const store = new SettingsStore();
    const seen: (string | undefined)[] = [];
    store.subscribe((changes) => seen.push(...changes.map((c) => c.effect)));
    store.set(["duckweed", "rippleResponse", "strength"], 4);
    store.set(["duckweed", "driftX"], 3);
    expect(store.live.duckweed.rippleResponse.strength).toBe(4);
    expect(seen).toEqual(["duckweed:live", "duckweed:rebuild"]);
  });

  it("reports koi:body with previous values for a single-field edit", () => {
    let seenPrev: unknown;
    store.subscribe((batch) => {
      const change = batch.find((c) => c.effect === "koi:body");
      if (change) seenPrev = change.prev;
    });
    store.set(["koi", "tinyEvery"], 5);
    expect(seenPrev).toBe(2);
  });

  it("reports tiny-fish:shift with prev/next coordinates for a school move", () => {
    let change: { prev?: unknown; next?: unknown } | undefined;
    store.subscribe((batch) => {
      const found = batch.find((c) => c.effect === "tiny-fish:shift");
      if (found) change = found;
    });
    store.set(["tiny-fish-schools", 0, "x"], 200);
    expect(change?.prev).toBe(174);
    expect(change?.next).toBe(200);
  });
  it("returns a stable meta() snapshot until something changes", () => {
    const first = store.meta();
    expect(store.meta()).toBe(first);
    store.setRain(true);
    expect(store.meta()).not.toBe(first);
    expect(store.meta().rain).toBe(true);
  });

  it("notifies a change for the grown collection itself", () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(["butterflies", "visibleCount"], 8);
    const batch = listener.mock.calls[0][0] as { path: (string | number)[] }[];
    expect(batch.some((change) => change.path.join(".") === "butterfly-spawns")).toBe(true);
  });

  it("notifies when resetting a section that has no effect tags", () => {
    store.set(["ripples", "types", "touch", "lifetime"], 3);
    const versionBefore = store.getVersion();
    store.resetSections(["ripples"]);
    expect(store.getVersion()).toBeGreaterThan(versionBefore);
  });
  it("undo restores an array edit made before a weather switch", () => {
    const deep = () => [...store.live["pond-bed"].deepColor];
    const initial = deep();
    store.set(["pond-bed", "deepColor"], [1, 0, 0]);
    store.setWeather("moonlight");
    store.set(["pond-bed", "deepColor"], [0, 1, 0]);
    store.undo();
    store.undo();
    expect(deep()).toEqual([1, 0, 0]);
    expect(store.meta().weather).toBe("sunny");
    store.undo();
    expect(deep()).toEqual(initial);
  });

  it("keeps live array identity when setting an array value", () => {
    const deepColor = store.live["pond-bed"].deepColor;
    store.set(["pond-bed", "deepColor"], [0.2, 0.3, 0.4]);
    expect(store.live["pond-bed"].deepColor).toBe(deepColor);
  });
});
