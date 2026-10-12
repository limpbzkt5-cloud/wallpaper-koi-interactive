// Effect-tag handlers: the store collects the tags touched by a batch of
// changes and this module runs the matching renderer/simulation refresh.
// Light effects run on the next animation frame; heavy ones are throttled to
// a trailing 100ms (replacing the old CONFIG_UPDATE_DELAY_MS).

import { CANVAS, CANVAS_HEIGHT, CANVAS_WIDTH } from "../config";
import type { FishRenderer } from "../fish-renderer";
import type { School } from "../school";
import type { Change, SettingsStore } from "./store";

export interface SettingsRuntime {
  school: School;
  renderer: FishRenderer;
}

interface EffectHandler {
  heavy?: boolean;
  run: (runtime: SettingsRuntime, store: SettingsStore, changes: readonly Change[]) => void;
}

const HANDLERS: Record<string, EffectHandler> = {
  "koi:count": {
    run: (runtime, store) => runtime.school.setCount(store.live.koi.initialCount),
  },
  "koi:body": {
    run: (runtime, store, changes) => {
      const koi = store.live.koi;
      // A bulk change (reset/undo/weather) reports one Change with
      // path == ["koi"] and `prev` holding the whole previous koi section;
      // a single-field edit reports path == ["koi", fieldName].
      const bulk = changes.find((c) => c.path.length === 1 && c.path[0] === "koi");
      const bulkPrev = bulk?.prev as Partial<typeof koi> | undefined;
      const prevOf = <K extends "regularLength" | "tinyLength" | "regularWidthRatio" | "tinyWidthRatio" | "tinyEvery">(
        key: K,
      ): (typeof koi)[K] => {
        if (bulkPrev) return bulkPrev[key] ?? koi[key];
        const change = changes.find((c) => c.path[0] === "koi" && c.path[1] === key);
        return change ? (change.prev as (typeof koi)[K]) : koi[key];
      };
      runtime.school.updateBodyProportions({
        regularLength: prevOf("regularLength"),
        tinyLength: prevOf("tinyLength"),
        regularWidthRatio: prevOf("regularWidthRatio"),
        tinyWidthRatio: prevOf("tinyWidthRatio"),
        tinyEvery: prevOf("tinyEvery"),
      });
    },
  },
  "koi:appearance": { run: (runtime) => runtime.renderer.refreshSection("koi") },
  "tiny-fish:render": { run: (runtime) => runtime.renderer.refreshSection("tiny-fish") },
  "tiny-fish:respawn": {
    heavy: true,
    run: (runtime) => runtime.school.tinyFish.refreshConfig(),
  },
  "tiny-fish:shift": {
    run: (runtime, _store, changes) => {
      for (const change of changes) {
        if (change.effect !== "tiny-fish:shift") continue;
        const index = change.path[1];
        const axis = change.path[2];
        if (typeof index !== "number" || (axis !== "x" && axis !== "y")) continue;
        if (typeof change.prev !== "number" || typeof change.next !== "number") continue;
        const delta = change.next - change.prev;
        const scaleX = CANVAS_WIDTH / CANVAS.width;
        const scaleY = CANVAS_HEIGHT / CANVAS.height;
        runtime.school.tinyFish.shiftSchool(
          index,
          axis === "x" ? delta * scaleX : 0,
          axis === "y" ? delta * scaleY : 0,
        );
      }
    },
  },
  "pond-bed": { run: (runtime) => runtime.renderer.refreshSection("pond-bed") },
  water: { run: (runtime) => runtime.renderer.refreshSection("water") },
  "lotus:rebuild": { run: (runtime) => runtime.renderer.refreshSection("lotus") },
  "duckweed:rebuild": { heavy: true, run: (runtime) => runtime.renderer.refreshSection("duckweed") },
  // Ripple-response settings are read live every frame; the tag only exists to
  // override the parent group's heavy "duckweed:rebuild".
  "duckweed:live": { run: () => {} },
  "butterflies:keep": { run: (runtime) => runtime.renderer.refreshSection("butterflies") },
  "butterflies:respawn": { run: (runtime) => runtime.renderer.refreshSection("butterfly-spawns") },
};

export function connectSettingsEffects(store: SettingsStore, runtime: SettingsRuntime): () => void {
  let pendingLight: Change[] = [];
  let pendingHeavy: Change[] = [];
  let lightFrame = 0;
  let heavyTimer = 0;

  const runTags = (changes: Change[]): void => {
    const tags = new Map<string, Change[]>();
    for (const change of changes) {
      if (!change.effect) continue;
      const list = tags.get(change.effect) ?? [];
      list.push(change);
      tags.set(change.effect, list);
    }
    for (const [tag, tagChanges] of tags) {
      HANDLERS[tag]?.run(runtime, store, tagChanges);
    }
  };

  const flushLight = (): void => {
    lightFrame = 0;
    const changes = pendingLight;
    pendingLight = [];
    runTags(changes);
  };

  const flushHeavy = (): void => {
    heavyTimer = 0;
    const changes = pendingHeavy;
    pendingHeavy = [];
    runTags(changes);
  };

  const unsubscribe = store.subscribe((batch) => {
    for (const change of batch) {
      if (!change.effect) continue;
      const handler = HANDLERS[change.effect];
      if (handler?.heavy) {
        pendingHeavy.push(change);
      } else {
        pendingLight.push(change);
      }
    }
    if (pendingLight.length > 0 && !lightFrame) {
      lightFrame = requestAnimationFrame(flushLight);
    }
    if (pendingHeavy.length > 0 && !heavyTimer) {
      heavyTimer = window.setTimeout(flushHeavy, 100);
    }
  });

  return () => {
    unsubscribe();
    if (lightFrame) cancelAnimationFrame(lightFrame);
    if (heavyTimer) window.clearTimeout(heavyTimer);
  };
}
