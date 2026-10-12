import type { Color } from "three";

// Pure geometry math for duckweed patches. Each patch is built once in
// patch-local space (origin = patch placement point, rotation 0); all patches
// are merged into one leaf buffer and one highlight buffer, and the vertex
// shader moves whole patches from a per-patch uniform every frame.

// Leaves are only 1–3 px across, so fewer segments visibly shrink them once
// rasterised. The geometry is static, so the segment count is free per frame.
export const DUCKWEED_LEAF_SEGMENTS = 7;
export const DUCKWEED_HIGHLIGHT_SEGMENTS = 5;
// Leaves at or below this radius get no highlight.
export const DUCKWEED_HIGHLIGHT_MIN_RADIUS = 1.55;

export interface DuckweedLeafShape {
  offsetX: number;
  offsetY: number;
  radius: number;
  angle: number;
  tone: number;
  paired: boolean;
  /** +1 or -1: which way the leaf spins when a ripple pushes it. Defaults to 1. */
  spinSign?: number;
}

export interface DuckweedPaletteColors {
  base: Color;
  light: Color;
  shade: Color;
  center: Color;
}

export interface DuckweedPatchBuffers {
  /** xyz triplets, three vertices per triangle. */
  positions: number[];
  /** rgb triplets matching `positions`. */
  colors: number[];
  /** xyz triplets, three vertices per highlight triangle. */
  highlightPositions: number[];
  /** rgb triplets matching `highlightPositions`. */
  highlightColors: number[];
  /** xy pairs matching `positions`: the patch-local center of the owning leaf. */
  leafCenters: number[];
  /** One value per vertex of `positions`: the owning leaf's spin sign. */
  leafSigns: number[];
  /** xy pairs matching `highlightPositions`. */
  highlightLeafCenters: number[];
  /** One value per vertex of `highlightPositions`. */
  highlightLeafSigns: number[];
}

/** Every patch's vertices for one mesh, concatenated in patch order. */
export interface DuckweedLayerBuffers {
  positions: Float32Array;
  colors: Float32Array;
  /** Patch-local center of the owning leaf (paired leaves and highlights use the parent leaf's). */
  leafCenters: Float32Array;
  leafSigns: Float32Array;
  patchIndices: Float32Array;
  /**
   * Length patches + 1: `patchVertexOffsets[n]` is the first vertex of patch n,
   * so the first n patches are drawn with a draw range of `patchVertexOffsets[n]`.
   */
  patchVertexOffsets: number[];
}

export interface DuckweedBuffers {
  leaf: DuckweedLayerBuffers;
  highlight: DuckweedLayerBuffers;
}

export interface DuckweedPatchInput {
  leaves: readonly DuckweedLeafShape[];
  palette: DuckweedPaletteColors;
}

interface Point {
  x: number;
  y: number;
}

// Per-vertex data shared by every vertex of one leaf (or its highlight).
interface Layer {
  positions: number[];
  colors: number[];
  leafCenters: number[];
  leafSigns: number[];
}

interface Owner {
  center: Point;
  sign: number;
}

function pushVertex(
  layer: Layer,
  owner: Owner,
  x: number,
  y: number,
  color: Color,
): void {
  layer.positions.push(x, y, 0);
  layer.colors.push(color.r, color.g, color.b);
  layer.leafCenters.push(owner.center.x, owner.center.y);
  layer.leafSigns.push(owner.sign);
}

function ellipsePoint(
  center: Point,
  radius: number,
  rotation: number,
  angle: number,
  verticalScale: number,
): Point {
  const localX = Math.cos(angle) * radius;
  const localY = Math.sin(angle) * radius * verticalScale;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: center.x + localX * cosine - localY * sine,
    y: center.y + localX * sine + localY * cosine,
  };
}

function pushLeaf(
  layer: Layer,
  owner: Owner,
  center: Point,
  radius: number,
  angle: number,
  color: Color,
  verticalScale: number,
): void {
  const segments = DUCKWEED_LEAF_SEGMENTS;
  for (let index = 0; index < segments; index += 1) {
    const angleA = (index / segments) * Math.PI * 2;
    const angleB = ((index + 1) / segments) * Math.PI * 2;
    const a = ellipsePoint(center, radius, angle, angleA, verticalScale);
    const b = ellipsePoint(center, radius, angle, angleB, verticalScale);
    pushVertex(layer, owner, center.x, center.y, color);
    pushVertex(layer, owner, a.x, a.y, color);
    pushVertex(layer, owner, b.x, b.y, color);
  }
}

function pushCircle(
  layer: Layer,
  owner: Owner,
  center: Point,
  radius: number,
  color: Color,
): void {
  const segments = DUCKWEED_HIGHLIGHT_SEGMENTS;
  for (let index = 0; index < segments; index += 1) {
    const angleA = (index / segments) * Math.PI * 2;
    const angleB = ((index + 1) / segments) * Math.PI * 2;
    pushVertex(layer, owner, center.x, center.y, color);
    pushVertex(
      layer,
      owner,
      center.x + Math.cos(angleA) * radius,
      center.y + Math.sin(angleA) * radius,
      color,
    );
    pushVertex(
      layer,
      owner,
      center.x + Math.cos(angleB) * radius,
      center.y + Math.sin(angleB) * radius,
      color,
    );
  }
}

export function duckweedLeafColor(
  tone: number,
  palette: DuckweedPaletteColors,
): Color {
  return tone < 0.24 ? palette.light : tone > 0.82 ? palette.shade : palette.base;
}

export function buildDuckweedPatchBuffers(
  leaves: readonly DuckweedLeafShape[],
  palette: DuckweedPaletteColors,
  verticalScale: number,
): DuckweedPatchBuffers {
  const leafLayer: Layer = { positions: [], colors: [], leafCenters: [], leafSigns: [] };
  const highlightLayer: Layer = { positions: [], colors: [], leafCenters: [], leafSigns: [] };

  for (const leaf of leaves) {
    const center = { x: leaf.offsetX, y: leaf.offsetY };
    const { radius, angle } = leaf;
    // A leaf, its pair and its highlight all move as one unit around `center`.
    const owner: Owner = { center, sign: leaf.spinSign ?? 1 };
    pushLeaf(
      leafLayer,
      owner,
      center,
      radius,
      angle,
      duckweedLeafColor(leaf.tone, palette),
      verticalScale,
    );
    if (radius > DUCKWEED_HIGHLIGHT_MIN_RADIUS) {
      pushCircle(
        highlightLayer,
        owner,
        {
          x: center.x - Math.cos(angle) * radius * 0.18,
          y: center.y - Math.sin(angle) * radius * 0.18,
        },
        Math.max(0.22, radius * 0.14),
        palette.center,
      );
    }
    if (leaf.paired) {
      const pairCenter = {
        x: center.x + Math.cos(angle + 0.8) * radius * 0.92,
        y: center.y + Math.sin(angle + 0.8) * radius * 0.92,
      };
      pushLeaf(
        leafLayer,
        owner,
        pairCenter,
        radius * 0.72,
        angle + 1.15,
        palette.light,
        verticalScale,
      );
    }
  }

  return {
    positions: leafLayer.positions,
    colors: leafLayer.colors,
    leafCenters: leafLayer.leafCenters,
    leafSigns: leafLayer.leafSigns,
    highlightPositions: highlightLayer.positions,
    highlightColors: highlightLayer.colors,
    highlightLeafCenters: highlightLayer.leafCenters,
    highlightLeafSigns: highlightLayer.leafSigns,
  };
}

function mergeLayers(
  patches: readonly {
    positions: readonly number[];
    colors: readonly number[];
    leafCenters: readonly number[];
    leafSigns: readonly number[];
  }[],
): DuckweedLayerBuffers {
  let vertexCount = 0;
  const patchVertexOffsets = [0];
  for (const patch of patches) {
    vertexCount += patch.positions.length / 3;
    patchVertexOffsets.push(vertexCount);
  }
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const leafCenters = new Float32Array(vertexCount * 2);
  const leafSigns = new Float32Array(vertexCount);
  const patchIndices = new Float32Array(vertexCount);
  for (const [patchIndex, patch] of patches.entries()) {
    const start = patchVertexOffsets[patchIndex];
    positions.set(patch.positions, start * 3);
    colors.set(patch.colors, start * 3);
    leafCenters.set(patch.leafCenters, start * 2);
    leafSigns.set(patch.leafSigns, start);
    patchIndices.fill(patchIndex, start, patchVertexOffsets[patchIndex + 1]);
  }
  return { positions, colors, leafCenters, leafSigns, patchIndices, patchVertexOffsets };
}

/** Builds every patch and concatenates them, in patch order, into one leaf and one highlight buffer set. */
export function buildDuckweedBuffers(
  patches: readonly DuckweedPatchInput[],
  verticalScale: number,
): DuckweedBuffers {
  const built = patches.map((patch) =>
    buildDuckweedPatchBuffers(patch.leaves, patch.palette, verticalScale),
  );
  return {
    leaf: mergeLayers(built),
    highlight: mergeLayers(
      built.map((buffers) => ({
        positions: buffers.highlightPositions,
        colors: buffers.highlightColors,
        leafCenters: buffers.highlightLeafCenters,
        leafSigns: buffers.highlightLeafSigns,
      })),
    ),
  };
}

// ---- vertex transform mirror ---------------------------------------------
// Keep in sync with the GLSL in duckweed.ts. These run on the CPU only in
// tests; the GPU does the same math per vertex.

export interface DuckweedPatchTransform {
  x: number;
  y: number;
  rotation: number;
}

/** One packed ripple as uploaded to the shader; `strength` already includes the per-type weight. */
export interface DuckweedRipple {
  x: number;
  y: number;
  age: number;
  strength: number;
  lifetime: number;
  startRadius: number;
  expansionSpeed: number;
}

export interface DuckweedRippleTuning {
  strength: number;
  bandWidth: number;
  falloffDistance: number;
  maxPush: number;
  spin: number;
}

export interface DuckweedVertexOptions {
  /** Patch-local center of the owning leaf; required for ripples to have an effect. */
  leafCenter?: Point;
  leafSign?: number;
  ripples?: readonly DuckweedRipple[];
  tuning?: DuckweedRippleTuning;
  /** Added in world space last (the shadow draw). */
  shadowOffset?: Point;
}

// 1 / max of x * exp(-x^2) over x = (d - front) / w, i.e. 1 / (exp(-0.5) / sqrt(2)).
export const DUCKWEED_RIPPLE_PEAK_SCALE = 2.33;

function rotate(x: number, y: number, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

/**
 * Ring-timed push and spin of a leaf whose world center is (leafX, leafY):
 * pushed outward as each ripple's expanding front arrives, back as it passes.
 */
export function duckweedRippleDisplacement(
  leafX: number,
  leafY: number,
  ripples: readonly DuckweedRipple[],
  tuning: DuckweedRippleTuning,
): { pushX: number; pushY: number; spin: number } {
  const width = Math.max(tuning.bandWidth, 1e-3);
  const falloffDistance = Math.max(tuning.falloffDistance, 1e-3);
  let pushX = 0;
  let pushY = 0;
  let spin = 0;
  for (const ripple of ripples) {
    const deltaX = leafX - ripple.x;
    const deltaY = leafY - ripple.y;
    const distance = Math.hypot(deltaX, deltaY);
    const dirX = distance > 0.001 ? deltaX / distance : 0;
    const dirY = distance > 0.001 ? deltaY / distance : 0;
    const front = ripple.startRadius + ripple.expansionSpeed * ripple.age;
    const x = distance - front;
    const envelope = Math.exp(-(x * x) / (width * width));
    const remaining = Math.min(
      Math.max(1 - ripple.age / Math.max(ripple.lifetime, 1e-4), 0),
      1,
    );
    const fade = remaining * remaining;
    const falloff = 1 / (1 + distance / falloffDistance);
    const amplitude = tuning.strength * ripple.strength * fade * falloff;
    const push = amplitude * envelope * (x / width) * DUCKWEED_RIPPLE_PEAK_SCALE;
    pushX += dirX * push;
    pushY += dirY * push;
    spin += amplitude * envelope * tuning.spin;
  }
  const length = Math.hypot(pushX, pushY);
  if (length > tuning.maxPush) {
    const scale = tuning.maxPush / length;
    pushX *= scale;
    pushY *= scale;
  }
  return { pushX, pushY, spin };
}

/** World position of a patch-local vertex: patch transform, ripple reaction, then shadow offset. */
export function duckweedVertexWorld(
  positionX: number,
  positionY: number,
  patch: DuckweedPatchTransform,
  options: DuckweedVertexOptions = {},
): Point {
  const rotated = rotate(positionX, positionY, patch.rotation);
  let x = patch.x + rotated.x;
  let y = patch.y + rotated.y;
  const { leafCenter, ripples, tuning } = options;
  if (leafCenter && ripples && tuning && ripples.length > 0) {
    const leafRotated = rotate(leafCenter.x, leafCenter.y, patch.rotation);
    const leafX = patch.x + leafRotated.x;
    const leafY = patch.y + leafRotated.y;
    const { pushX, pushY, spin } = duckweedRippleDisplacement(
      leafX,
      leafY,
      ripples,
      tuning,
    );
    const spun = rotate(x - leafX, y - leafY, spin * (options.leafSign ?? 1));
    x = leafX + spun.x + pushX;
    y = leafY + spun.y + pushY;
  }
  if (options.shadowOffset) {
    x += options.shadowOffset.x;
    y += options.shadowOffset.y;
  }
  return { x, y };
}
