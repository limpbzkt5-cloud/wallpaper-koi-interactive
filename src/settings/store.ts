// The single settings store: owns `live` (the mutable tree consumers read
// every frame), the sparse user overrides, the weather layer, undo/redo, and
// change notification. See docs/how-it-works.md for the layering model.

import {
  defaults as buildDefaults,
  nodeAt,
  validate as validateNode,
  walk,
  type AnyNode,
  type SettingPath,
} from "./schema";
import { definition, type SectionId, type SettingsValues } from "./definition";
import { getWeatherPreset, type WeatherPresetId } from "../weather";

export interface Change {
  path: SettingPath;
  prev: unknown;
  next: unknown;
  effect?: string;
  keepsFamilyPreview?: boolean;
}

export type ChangeListener = (batch: readonly Change[]) => void;

interface UndoEntry {
  overrides: Map<string, unknown>;
  weather: WeatherPresetId;
  rain: boolean;
}

interface SetOptions {
  interaction?: string;
}

const UNDO_LIMIT = 50;
const GROUP_WINDOW_MS = 550;

function keyOf(path: SettingPath): string {
  return path.join(".");
}

function isContainer(value: unknown): value is Record<string | number, unknown> {
  return value !== null && typeof value === "object";
}

function readAt(root: unknown, path: SettingPath): unknown {
  let value = root;
  for (const segment of path) {
    if (!isContainer(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function writeAt(root: unknown, path: SettingPath, value: unknown): void {
  let target: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (!isContainer(target)) return;
    target = target[segment];
  }
  if (isContainer(target)) {
    (target as Record<string | number, unknown>)[path[path.length - 1]] = value;
  }
}

// Mutates `target` in place to match `source`, preserving object/array
// identity (arrays are resized via `.length`, not replaced).
function copyInto(target: unknown, source: unknown): void {
  if (Array.isArray(target) && Array.isArray(source)) {
    target.length = source.length;
    for (let i = 0; i < source.length; i += 1) {
      const s = source[i];
      const t = target[i];
      if (isContainer(t) && isContainer(s) && Array.isArray(t) === Array.isArray(s)) {
        copyInto(t, s);
      } else {
        target[i] = structuredClone(s);
      }
    }
    return;
  }
  if (isContainer(target) && isContainer(source) && !Array.isArray(target) && !Array.isArray(source)) {
    for (const key of Object.keys(source)) {
      const s = source[key];
      const t = target[key];
      if (isContainer(t) && isContainer(s) && Array.isArray(t) === Array.isArray(s)) {
        copyInto(t, s);
      } else {
        target[key] = structuredClone(s);
      }
    }
  }
}

/** Nearest ancestor (including the leaf itself) that declares `key`, walking up from the leaf. */
function inheritedMeta<K extends "effect" | "keepsFamilyPreview">(
  root: AnyNode,
  path: SettingPath,
  key: K,
): AnyNode[K] | undefined {
  for (let i = path.length; i >= 0; i -= 1) {
    const node = nodeAt(root, path.slice(0, i));
    if (node && node[key] !== undefined) return node[key];
  }
  return undefined;
}

/** Returns the collection's own path if `path` runs through a collection node, else undefined. */
function collectionRootOf(root: AnyNode, path: SettingPath): SettingPath | undefined {
  let node: AnyNode = root;
  for (let i = 0; i < path.length; i += 1) {
    if (node.kind === "collection") return path.slice(0, i);
    const next = nodeAt(root, path.slice(0, i + 1));
    if (!next) return undefined;
    node = next;
  }
  return undefined;
}

function weatherSparseSections(id: WeatherPresetId): Partial<Record<SectionId, unknown>> {
  const preset = getWeatherPreset(id);
  // WeatherConfigValues keys are already section ids (koi, pond-bed, water).
  return preset.config as unknown as Partial<Record<SectionId, unknown>>;
}

/** Every leaf path a weather preset can own (same shape for every preset). */
function weatherOwnedLeafPaths(root: AnyNode): SettingPath[] {
  const sample = weatherSparseSections("sunny");
  const paths: SettingPath[] = [];
  const visit = (value: unknown, path: SettingPath): void => {
    if (isContainer(value) && !Array.isArray(value) && nodeAt(root, path)?.kind === "group") {
      for (const key of Object.keys(value)) visit(value[key], [...path, key]);
    } else {
      paths.push(path);
    }
  };
  for (const section of Object.keys(sample) as SectionId[]) {
    visit(sample[section], [section]);
  }
  return paths;
}

export class SettingsStore {
  public readonly live: SettingsValues;

  private readonly overrides = new Map<string, unknown>();
  private weatherId: WeatherPresetId = "sunny";
  private rain = false;
  private readonly listeners = new Set<ChangeListener>();
  private readonly pathListeners = new Map<string, Set<() => void>>();
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private openInteraction: { key: string; at: number } | null = null;
  private readonly weatherOwned: SettingPath[];
  private readonly sectionEffectTags = new Map<SectionId, Set<string>>();
  // Bumped on every notification so React snapshots can be cached per version.
  private version = 0;
  private metaCache: { version: number; value: ReturnType<SettingsStore["meta"]> } | null = null;

  public constructor() {
    this.live = buildDefaults(definition) as SettingsValues;
    this.weatherOwned = weatherOwnedLeafPaths(definition);
    for (const id of Object.keys(definition.children) as SectionId[]) {
      const tags = new Set<string>();
      walk(definition.children[id], (node) => {
        if (node.effect) tags.add(node.effect);
      });
      this.sectionEffectTags.set(id, tags);
    }
    this.recomputeAll();
  }

  // ---- reads -------------------------------------------------------

  public get(path: SettingPath): unknown {
    return readAt(this.live, path);
  }

  public getVersion(): number {
    return this.version;
  }

  // Cached per version: useSyncExternalStore requires a stable snapshot.
  public meta(): { weather: WeatherPresetId; rain: boolean; canUndo: boolean; canRedo: boolean } {
    if (this.metaCache?.version === this.version) return this.metaCache.value;
    const value = {
      weather: this.weatherId,
      rain: this.rain,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    this.metaCache = { version: this.version, value };
    return value;
  }

  // ---- subscriptions -------------------------------------------------

  public subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public subscribePath(path: SettingPath, callback: () => void): () => void {
    const key = keyOf(path);
    let set = this.pathListeners.get(key);
    if (!set) {
      set = new Set();
      this.pathListeners.set(key, set);
    }
    set.add(callback);
    return () => set?.delete(callback);
  }

  private notify(batch: Change[]): void {
    if (batch.length === 0) return;
    this.version += 1;
    const touchedPaths = new Set(batch.map((change) => keyOf(change.path)));
    for (const listener of this.listeners) listener(batch);
    for (const key of touchedPaths) {
      const set = this.pathListeners.get(key);
      if (set) for (const callback of set) callback();
    }
  }

  // ---- effective-value computation ------------------------------------

  /** Recomputes one section fully (defaults ⊕ weather ⊕ overrides) into `live`, in place. */
  private recomputeSection(id: SectionId): void {
    const sectionDefaults = readAt(buildDefaults(definition), [id]);
    const next = structuredClone(sectionDefaults);
    const weather = weatherSparseSections(this.weatherId);
    const weatherSection = (weather as Record<string, unknown>)[id];
    if (weatherSection !== undefined) copyInto(next, weatherSection);
    // Apply sparse overrides that live under this section, from shallowest to
    // deepest so a collection override (e.g. "tiny-fish-schools") wins over
    // any (impossible, but defensive) shorter prefix.
    const prefix = `${id}`;
    for (const [key, value] of this.overrides) {
      if (key !== prefix && !key.startsWith(`${prefix}.`)) continue;
      const relative = key === prefix ? [] : key.slice(prefix.length + 1).split(".");
      const path = relative.map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
      if (path.length === 0) {
        copyInto(next, value);
      } else {
        writeAt(next, path, structuredClone(value));
      }
    }
    copyInto((this.live as Record<string, unknown>)[id], next);
  }

  private recomputeAll(): void {
    for (const id of Object.keys(definition.children) as SectionId[]) this.recomputeSection(id);
  }

  // ---- writes ----------------------------------------------------------

  public set(path: SettingPath, rawValue: unknown, options: SetOptions = {}): void {
    const node = nodeAt(definition, path);
    if (!node) return;
    const value = validateNode(node, rawValue, definition, this.live);
    if (value === undefined) return;

    const prev = structuredClone(this.get(path));
    this.beginOrContinueInteraction(options.interaction);
    const current = this.get(path);
    if (Array.isArray(current) && Array.isArray(value)) copyInto(current, value);
    else writeAt(this.live, path, structuredClone(value));

    const collectionRoot = collectionRootOf(definition, path);
    if (collectionRoot) {
      this.overrides.set(keyOf(collectionRoot), structuredClone(this.get(collectionRoot)));
    } else {
      // Clone so in-place recomputes of `live` can't mutate the stored override
      // (or undo snapshots that share it) for array values like rgb/range.
      this.overrides.set(keyOf(path), structuredClone(value));
    }

    const changes: Change[] = [
      {
        path,
        prev,
        next: value,
        effect: inheritedMeta(definition, path, "effect"),
        keepsFamilyPreview: inheritedMeta(definition, path, "keepsFamilyPreview") === true,
      },
    ];

    changes.push(...this.growCollectionsFor(path, value));

    this.redoStack.length = 0;
    this.notify(changes);
    this.schedulePersist();
  }

  // Returns effect-less changes so the UI refreshes grown collections; the
  // count setting's own effect tag already refreshes the pond.
  private growCollectionsFor(countPath: SettingPath, value: unknown): Change[] {
    const changes: Change[] = [];
    if (typeof value !== "number") return changes;
    for (const id of Object.keys(definition.children) as SectionId[]) {
      const node = definition.children[id];
      if (node.kind !== "collection") continue;
      if (keyOf(node.countFrom) !== keyOf(countPath)) continue;
      const array = (this.live as Record<string, unknown>)[id];
      if (!Array.isArray(array)) continue;
      const requested = Math.max(0, Math.round(value));
      const max = node.max ?? 64;
      const target = Math.min(requested, max);
      const previousLength = array.length;
      while (array.length < target) array.push(node.create(this.live));
      if (array.length !== previousLength || this.overrides.has(id)) {
        this.overrides.set(id, structuredClone(array));
      }
      if (array.length !== previousLength) {
        changes.push({ path: [id], prev: previousLength, next: array.length, keepsFamilyPreview: false });
      }
    }
    return changes;
  }

  private beginOrContinueInteraction(interaction: string | undefined): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const key = interaction ?? Math.random().toString(36);
    const open = this.openInteraction;
    if (open && open.key === key && now - open.at <= GROUP_WINDOW_MS) {
      this.openInteraction = { key, at: now };
      return;
    }
    this.pushUndoSnapshot();
    this.openInteraction = { key, at: now };
  }

  private pushUndoSnapshot(): void {
    this.undoStack.push({
      overrides: new Map(this.overrides),
      weather: this.weatherId,
      rain: this.rain,
    });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  // ---- bulk operations (fire every relevant effect tag) -----------------

  private fullRefresh(sections: readonly SectionId[]): void {
    const before = new Map(sections.map((id) => [id, structuredClone((this.live as Record<string, unknown>)[id])]));
    for (const id of sections) this.recomputeSection(id);
    const tags = new Set<string>();
    for (const id of sections) {
      for (const tag of this.sectionEffectTags.get(id) ?? []) {
        // Bulk operations replace the whole section; a full tiny-fish respawn
        // already covers repositioning, so the drag-only "shift" tag is
        // redundant here.
        if (tag === "tiny-fish:shift") continue;
        tags.add(tag);
      }
    }
    const keepsFamilyPreview = sections.every((id) => id === "koi-palettes" || id === "koi-patterns");
    const changes: Change[] = [...tags].map((effect) => {
      const id = sections.find((sectionId) => this.sectionEffectTags.get(sectionId)?.has(effect)) ?? sections[0];
      return {
        path: [id],
        prev: before.get(id),
        next: (this.live as Record<string, unknown>)[id],
        effect,
        keepsFamilyPreview,
      };
    });
    // Sections without effect tags (read every frame) still need to notify
    // the UI so their controls show the recomputed values.
    for (const id of sections) {
      if ((this.sectionEffectTags.get(id)?.size ?? 0) > 0) continue;
      changes.push({
        path: [id],
        prev: before.get(id),
        next: (this.live as Record<string, unknown>)[id],
        keepsFamilyPreview,
      });
    }
    this.notify(changes);
  }

  public resetSections(ids: readonly SectionId[]): void {
    this.pushUndoSnapshot();
    this.openInteraction = null;
    for (const key of [...this.overrides.keys()]) {
      const root = key.split(".")[0];
      if ((ids as readonly string[]).includes(root)) this.overrides.delete(key);
    }
    this.redoStack.length = 0;
    this.fullRefresh(ids);
    this.schedulePersist();
  }

  public resetAll(): void {
    this.pushUndoSnapshot();
    this.openInteraction = null;
    this.overrides.clear();
    this.weatherId = "sunny";
    this.rain = false;
    this.redoStack.length = 0;
    this.fullRefresh(Object.keys(definition.children) as SectionId[]);
    this.schedulePersist();
  }

  public setWeather(id: WeatherPresetId): void {
    this.pushUndoSnapshot();
    this.openInteraction = null;
    for (const path of this.weatherOwned) this.overrides.delete(keyOf(path));
    this.weatherId = id;
    this.rain = getWeatherPreset(id).rainStrength > 0;
    this.redoStack.length = 0;
    this.fullRefresh(["koi", "pond-bed", "water"]);
    this.schedulePersist();
  }

  public setRain(on: boolean): void {
    this.pushUndoSnapshot();
    this.openInteraction = null;
    this.rain = on;
    this.redoStack.length = 0;
    this.notify([{ path: ["__rain__"], prev: !on, next: on, effect: "rain" }]);
    this.schedulePersist();
  }

  public undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({
      overrides: new Map(this.overrides),
      weather: this.weatherId,
      rain: this.rain,
    });
    this.openInteraction = null;
    this.overrides.clear();
    for (const [key, value] of entry.overrides) this.overrides.set(key, value);
    this.weatherId = entry.weather;
    this.rain = entry.rain;
    this.fullRefresh(Object.keys(definition.children) as SectionId[]);
    this.schedulePersist();
  }

  public redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({
      overrides: new Map(this.overrides),
      weather: this.weatherId,
      rain: this.rain,
    });
    this.openInteraction = null;
    this.overrides.clear();
    for (const [key, value] of entry.overrides) this.overrides.set(key, value);
    this.weatherId = entry.weather;
    this.rain = entry.rain;
    this.fullRefresh(Object.keys(definition.children) as SectionId[]);
    this.schedulePersist();
  }

  // ---- persistence hook (wired by persistence.ts) -----------------------

  private persistHandler: (() => void) | null = null;
  private persistTimer = 0;

  public onPersistRequested(handler: () => void): void {
    this.persistHandler = handler;
  }

  private schedulePersist(): void {
    if (!this.persistHandler) return;
    if (this.persistTimer) return;
    const schedule = typeof window !== "undefined" ? window.setTimeout : setTimeout;
    this.persistTimer = schedule(() => {
      this.persistTimer = 0;
      this.persistHandler?.();
    }, 600) as unknown as number;
  }

  public flushPersist(): void {
    if (this.persistTimer) {
      const clear = typeof window !== "undefined" ? window.clearTimeout : clearTimeout;
      clear(this.persistTimer);
      this.persistTimer = 0;
    }
    this.persistHandler?.();
  }

  // ---- serialization (used by persistence.ts) ----------------------------

  public exportOverrides(): Record<string, unknown> {
    return Object.fromEntries(this.overrides);
  }

  public importOverrides(saved: Record<string, unknown>, weather: WeatherPresetId, rain: boolean): void {
    this.overrides.clear();
    for (const [key, value] of Object.entries(saved)) {
      const path = key.split(".").map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
      const node = nodeAt(definition, path);
      if (!node) continue; // Unknown paths (e.g. a removed setting) are dropped.
      if (node.kind === "collection") {
        if (!Array.isArray(value)) continue;
        const max = node.max ?? 64;
        const validated = value.slice(0, max).map((item) => item); // items validated on read
        this.overrides.set(key, validated);
      } else if (node.kind === "group" || node.kind === "list") {
        this.overrides.set(key, value);
      } else {
        const validated = validateNode(node, value, definition, this.live);
        if (validated !== undefined) this.overrides.set(key, validated);
      }
    }
    this.weatherId = weather;
    this.rain = rain;
    this.recomputeAll();
  }
}

export const settings = new SettingsStore();
