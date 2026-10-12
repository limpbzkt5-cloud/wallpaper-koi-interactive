// v2 load/save, and a v1 -> v2 migration so a returning visitor's saved
// weather/config still applies (see docs/how-it-works.md).

import { defaults as buildDefaults, validate as validateNode, walkLeaves } from "./schema";
import { definition, type SectionId } from "./definition";
import type { SettingsStore } from "./store";
import { WEATHER_PRESETS, type WeatherPresetId } from "../weather";

const STORAGE_KEY_V2 = "nagomi:pond-settings:v2";
const STORAGE_KEY_V1 = "nagomi:pond-settings:v1";

interface SavedV2 {
  version: 2;
  overrides: Record<string, unknown>;
  weather: WeatherPresetId;
  rain: boolean;
}

function isValidWeather(id: unknown): id is WeatherPresetId {
  return WEATHER_PRESETS.some((preset) => preset.id === id);
}

function readJson(key: string): unknown {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A disabled or full browser storage area must never stop the pond.
  }
}

function removeKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

/** Diffs a v1 whole-section draft against defaults ⊕ weather, leaf by leaf. */
function migrateV1ToOverrides(draft: Record<string, unknown>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const defaultsTree = buildDefaults(definition) as Record<string, unknown>;
  const growableSections = new Set<SectionId>([
    "tiny-fish-schools", "lotus-leaves", "lotus-flowers", "duckweed-patches", "butterfly-spawns",
  ]);

  for (const id of Object.keys(definition.children) as SectionId[]) {
    const node = definition.children[id];
    const savedSection = draft[id];
    if (savedSection === undefined) continue;

    if (node.kind === "list" || node.kind === "collection") {
      if (!Array.isArray(savedSection)) continue;
      const defaultSection = defaultsTree[id];
      const changed =
        JSON.stringify(savedSection) !== JSON.stringify(defaultSection) &&
        (growableSections.has(id) || savedSection.length === (defaultSection as unknown[]).length);
      if (changed) overrides[id] = savedSection;
      continue;
    }

    // A plain group section (koi, tiny-fish, pond-bed, water, ripples, lotus, duckweed, butterflies):
    // diff leaf by leaf against defaults, since weather can own a few of them.
    walkLeaves(node, (leafNode, relativePath) => {
      const path = [id, ...relativePath];
      const savedValue = relativePath.reduce<unknown>(
        (value, segment) => (value && typeof value === "object" ? (value as Record<string | number, unknown>)[segment] : undefined),
        savedSection,
      );
      if (savedValue === undefined) return;
      const defaultValue = relativePath.reduce<unknown>(
        (value, segment) => (value && typeof value === "object" ? (value as Record<string | number, unknown>)[segment] : undefined),
        defaultsTree[id],
      );
      if (JSON.stringify(savedValue) === JSON.stringify(defaultValue)) return;
      const validated = validateNode(leafNode, savedValue, definition);
      if (validated !== undefined) overrides[path.join(".")] = validated;
    });
  }

  return overrides;
}

export function loadInto(store: SettingsStore): void {
  const savedV2 = readJson(STORAGE_KEY_V2) as Partial<SavedV2> | null;
  if (savedV2 && savedV2.version === 2 && isValidWeather(savedV2.weather)) {
    store.importOverrides(
      (savedV2.overrides as Record<string, unknown>) ?? {},
      savedV2.weather,
      savedV2.rain === true,
    );
    return;
  }

  const savedV1 = readJson(STORAGE_KEY_V1) as { version?: number; config?: unknown; weather?: unknown; rain?: unknown } | null;
  if (savedV1 && savedV1.version === 1 && isValidWeather(savedV1.weather) && savedV1.config && typeof savedV1.config === "object") {
    const overrides = migrateV1ToOverrides(savedV1.config as Record<string, unknown>);
    store.importOverrides(overrides, savedV1.weather, savedV1.rain === true);
    save(store);
    removeKey(STORAGE_KEY_V1);
  }
}

export function save(store: SettingsStore): void {
  const meta = store.meta();
  const payload: SavedV2 = {
    version: 2,
    overrides: store.exportOverrides(),
    weather: meta.weather,
    rain: meta.rain,
  };
  writeJson(STORAGE_KEY_V2, payload);
}

export function connectPersistence(store: SettingsStore): () => void {
  store.onPersistRequested(() => save(store));
  const onPageHide = (): void => store.flushPersist();
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  return () => {
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
  };
}

// Exported for tests only.
export const __internal = { migrateV1ToOverrides, STORAGE_KEY_V1, STORAGE_KEY_V2 };
