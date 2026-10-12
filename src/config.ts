// Scene tuning file. Values now live in the settings store (src/settings/);
// this file re-exports stable-identity slices of `settings.live` so the ~15
// consumer modules (school.ts, koi.ts, lotus-leaves.ts, water-surface.ts, …)
// need no changes. See src/settings/definition.ts to add or tune a setting.

import { settings } from "./settings/store";
import type {
  ButterflySpawnSetting,
  DuckweedPatchSetting,
  KoiPaletteSetting,
  KoiPatchSetting,
  LotusFlowerSetting,
  LotusLeafSetting,
  Rgb,
  TinyFishSchoolSetting,
} from "./settings/definition";

export { MAX_DUCKWEED_PATCHES } from "./settings/definition";

export type {
  ButterflySpawnSetting,
  DuckweedPatchSetting,
  KoiPaletteSetting,
  KoiPatchSetting,
  LotusFlowerSetting,
  LotusLeafSetting,
  Rgb,
  TinyFishSchoolSetting,
};

export const CANVAS = {
  width: 480,
  height: 270,
} as const;

export const SIMULATION = {
  updatesPerSecond: 60,
  spineNodes: 14,
} as const;

const live = settings.live;

// `maximumCount`/`maximumInstances` are fixed engine limits, not user
// settings — attached once here rather than modeled in the schema.
export const FISH: typeof live.koi & { maximumCount: number } = Object.assign(live.koi, {
  maximumCount: 48,
});
export const TINY_FISH = live["tiny-fish"];
export const TINY_FISH_SCHOOLS = live["tiny-fish-schools"];
export const KOI_PALETTES = live["koi-palettes"];
export const KOI_PATTERN_PATCHES = live["koi-patterns"];
export const POND_BED = live["pond-bed"];
export const RIPPLES: typeof live.ripples & { maximumInstances: number } = Object.assign(live.ripples, {
  maximumInstances: 64,
});
export const WATER = live.water;
export const LOTUS = live.lotus;
export const LOTUS_LEAVES = live["lotus-leaves"];
export const LOTUS_FLOWERS = live["lotus-flowers"];
export const DUCKWEED = live.duckweed;
export const DUCKWEED_PATCHES = live["duckweed-patches"];
export const BUTTERFLIES = live.butterflies;
export const BUTTERFLY_SPAWNS = live["butterfly-spawns"];

// The settings coordinates above remain in the original landscape layout.
// The simulation and renderer use these live dimensions for the visible pond.
export let CANVAS_WIDTH: number = CANVAS.width;
export let CANVAS_HEIGHT: number = CANVAS.height;

export function setCanvasSize(width: number, height: number): void {
  CANVAS_WIDTH = Math.max(1, Math.round(width));
  CANVAS_HEIGHT = Math.max(1, Math.round(height));
}

export function viewportPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: (x / CANVAS.width) * CANVAS_WIDTH,
    y: (y / CANVAS.height) * CANVAS_HEIGHT,
  };
}
export const MAX_FISH = FISH.maximumCount;
export const INITIAL_FISH = FISH.initialCount;
export const SPINE_NODES = SIMULATION.spineNodes;
export const MAX_RIPPLES = RIPPLES.maximumInstances;
export const MAX_RIPPLE_TYPES = Object.keys(RIPPLES.types).length;
export const RIPPLE_LIFETIME = RIPPLES.types.touch.lifetime;
export const FIXED_STEP = 1 / SIMULATION.updatesPerSecond;
export const TAU = Math.PI * 2;
