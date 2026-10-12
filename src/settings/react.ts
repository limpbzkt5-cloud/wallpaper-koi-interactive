// React bindings over the settings store via useSyncExternalStore.
// Snapshots are cached per store version: primitives compare by value, and
// arrays (rgb, range, vec2) are copied only when their contents change, since
// `live` arrays are mutated in place and would otherwise never re-render.

import { useCallback, useRef, useSyncExternalStore } from "react";
import { settings } from "./store";
import type { SettingPath } from "./schema";
import type { WeatherPresetId } from "../weather";

const subscribeToSettings = (onStoreChange: () => void): (() => void) =>
  settings.subscribe(() => onStoreChange());

const sameArray = (a: unknown, b: readonly unknown[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));

function useVersionedSnapshot<T>(read: () => T, key: string): T {
  const cacheRef = useRef<{ version: number; key: string; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const version = settings.getVersion();
    const cache = cacheRef.current;
    if (cache && cache.version === version && cache.key === key) return cache.value;
    const raw = read();
    let value = raw;
    if (Array.isArray(raw)) {
      value = (cache && sameArray(cache.value, raw) ? cache.value : [...raw]) as T;
    }
    cacheRef.current = { version, key, value };
    return value;
    // `read` is derived from `key`, so it's intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useSyncExternalStore(subscribeToSettings, getSnapshot, getSnapshot);
}

export function useSetting<T = unknown>(path: SettingPath): [T, (value: T, interaction?: string) => void] {
  const key = JSON.stringify(path);
  const value = useVersionedSnapshot(() => settings.get(path) as T, key);
  const setValue = useCallback(
    // Default to the path so a drag on one control groups into one undo entry.
    (next: T, interaction?: string) => settings.set(path, next, { interaction: interaction ?? key }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, setValue];
}

export function useCollectionLength(sectionId: string): number {
  return useVersionedSnapshot(() => {
    const value = settings.get([sectionId]);
    return Array.isArray(value) ? value.length : 0;
  }, sectionId);
}

export interface SettingsMeta {
  weather: WeatherPresetId;
  rain: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

const getMeta = (): SettingsMeta => settings.meta();

export function useSettingsMeta(): SettingsMeta {
  return useSyncExternalStore(subscribeToSettings, getMeta, getMeta);
}
