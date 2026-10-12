// Per-device performance preference. Deliberately separate from the settings
// store: it is not undoable, not affected by weather, and not reset by
// "Reset all".

export type FrameRateCap = "native" | "60" | "30" | "20";

export interface PerformancePrefs {
  version: 1;
  frameRate: FrameRateCap;
  /** True once the user picked a value from the menu themselves. */
  explicit: boolean;
}

export interface FrameRateOption {
  id: FrameRateCap;
  label: string;
  description: string;
  /** null means no cap (match the display refresh rate). */
  fps: number | null;
}

export const FRAME_RATE_OPTIONS: readonly FrameRateOption[] = [
  { id: "native", label: "Native", description: "Match the display refresh rate", fps: null },
  { id: "60", label: "60 fps", description: "Smooth", fps: 60 },
  { id: "30", label: "30 fps", description: "Balanced · best for ambient/screensaver", fps: 30 },
  { id: "20", label: "20 fps", description: "Battery saver", fps: 20 },
];

export const DEFAULT_FRAME_RATE: FrameRateCap = "60";
export const AMBIENT_FRAME_RATE: FrameRateCap = "30";
export const PERFORMANCE_STORAGE_KEY = "nagomi:performance:v1";

export function defaultPerformancePrefs(): PerformancePrefs {
  return { version: 1, frameRate: DEFAULT_FRAME_RATE, explicit: false };
}

export function isFrameRateCap(value: unknown): value is FrameRateCap {
  return FRAME_RATE_OPTIONS.some((option) => option.id === value);
}

export function frameRateOption(cap: FrameRateCap): FrameRateOption {
  return FRAME_RATE_OPTIONS.find((option) => option.id === cap) ?? FRAME_RATE_OPTIONS[1];
}

export function loadPerformancePrefs(): PerformancePrefs {
  try {
    if (typeof localStorage === "undefined") return defaultPerformancePrefs();
    const raw = localStorage.getItem(PERFORMANCE_STORAGE_KEY);
    if (!raw) return defaultPerformancePrefs();
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return defaultPerformancePrefs();
    const { version, frameRate, explicit } = data as Record<string, unknown>;
    if (version !== 1 || !isFrameRateCap(frameRate)) return defaultPerformancePrefs();
    return { version: 1, frameRate, explicit: explicit === true };
  } catch {
    return defaultPerformancePrefs();
  }
}

export function savePerformancePrefs(prefs: PerformancePrefs): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A disabled or full browser storage area must never stop the pond.
  }
}

/** An explicit pick always wins; otherwise ambient mode defaults to 30. */
export function effectiveFrameRate(prefs: PerformancePrefs, ambientMode: boolean): FrameRateCap {
  if (prefs.explicit) return prefs.frameRate;
  return ambientMode ? AMBIENT_FRAME_RATE : DEFAULT_FRAME_RATE;
}
