import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERFORMANCE_STORAGE_KEY,
  defaultPerformancePrefs,
  effectiveFrameRate,
  loadPerformancePrefs,
  savePerformancePrefs,
} from "./performance-prefs";

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("performance prefs", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeMemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to 60, not explicit", () => {
    expect(loadPerformancePrefs()).toEqual({ version: 1, frameRate: "60", explicit: false });
  });

  it("round-trips a saved value", () => {
    savePerformancePrefs({ version: 1, frameRate: "20", explicit: true });
    expect(loadPerformancePrefs()).toEqual({ version: 1, frameRate: "20", explicit: true });
    expect(JSON.parse(storage.getItem(PERFORMANCE_STORAGE_KEY) ?? "")).toEqual({
      version: 1,
      frameRate: "20",
      explicit: true,
    });
  });

  it("falls back to the default for invalid data", () => {
    for (const raw of ["not json", "null", '{"version":2,"frameRate":"30"}', '{"version":1,"frameRate":"144"}']) {
      storage.setItem(PERFORMANCE_STORAGE_KEY, raw);
      expect(loadPerformancePrefs()).toEqual(defaultPerformancePrefs());
    }
  });

  it("treats a non-boolean explicit flag as false", () => {
    storage.setItem(PERFORMANCE_STORAGE_KEY, '{"version":1,"frameRate":"30","explicit":"yes"}');
    expect(loadPerformancePrefs().explicit).toBe(false);
  });

  it("survives unavailable storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadPerformancePrefs()).toEqual(defaultPerformancePrefs());
    expect(() => savePerformancePrefs(defaultPerformancePrefs())).not.toThrow();
  });

  it("uses 30 in ambient mode only when the user has not chosen", () => {
    const auto = defaultPerformancePrefs();
    expect(effectiveFrameRate(auto, false)).toBe("60");
    expect(effectiveFrameRate(auto, true)).toBe("30");
    const explicit = { version: 1 as const, frameRate: "native" as const, explicit: true };
    expect(effectiveFrameRate(explicit, false)).toBe("native");
    expect(effectiveFrameRate(explicit, true)).toBe("native");
  });
});
