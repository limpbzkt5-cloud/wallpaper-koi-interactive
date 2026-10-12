import { Color, Mesh } from "three";
import { describe, expect, it } from "vitest";
import {
  buildDuckweedBuffers,
  buildDuckweedPatchBuffers,
  DUCKWEED_HIGHLIGHT_SEGMENTS,
  DUCKWEED_LEAF_SEGMENTS,
  duckweedRippleDisplacement,
  duckweedVertexWorld,
  type DuckweedLeafShape,
  type DuckweedPaletteColors,
  type DuckweedRipple,
  type DuckweedRippleTuning,
} from "./duckweed-geometry";

const palette: DuckweedPaletteColors = {
  base: new Color(0x6fc94f),
  light: new Color(0x9be66c),
  shade: new Color(0x45963e),
  center: new Color(0xc3ee75),
};
const verticalScale = 0.76;

// The previous per-frame world-space formulas, kept as the reference.
function worldEllipsePoint(
  center: { x: number; y: number },
  radius: number,
  rotation: number,
  angle: number,
) {
  const localX = Math.cos(angle) * radius;
  const localY = Math.sin(angle) * radius * verticalScale;
  return {
    x: center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
    y: center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation),
  };
}

function worldLeafTriangles(
  center: { x: number; y: number },
  radius: number,
  angle: number,
): number[] {
  const out: number[] = [];
  for (let index = 0; index < DUCKWEED_LEAF_SEGMENTS; index += 1) {
    const a = worldEllipsePoint(
      center,
      radius,
      angle,
      (index / DUCKWEED_LEAF_SEGMENTS) * Math.PI * 2,
    );
    const b = worldEllipsePoint(
      center,
      radius,
      angle,
      ((index + 1) / DUCKWEED_LEAF_SEGMENTS) * Math.PI * 2,
    );
    out.push(center.x, center.y, a.x, a.y, b.x, b.y);
  }
  return out;
}

describe("duckweed patch geometry", () => {
  const leaves: DuckweedLeafShape[] = [
    { offsetX: 6.5, offsetY: -3.25, radius: 2.4, angle: 1.1, tone: 0.5, paired: true, spinSign: 1 },
    { offsetX: -9, offsetY: 4, radius: 1.2, angle: 4.2, tone: 0.1, paired: false, spinSign: -1 },
    { offsetX: 1.5, offsetY: 7.75, radius: 3.3, angle: 5.9, tone: 0.9, paired: true, spinSign: -1 },
  ];
  const placement = { x: 41.7, y: 88.2 };
  const drift = { x: 2.3, y: -1.9 };
  const rotation = 0.037;

  it("matches the world-space formula once transformed by the patch", () => {
    const buffers = buildDuckweedPatchBuffers(leaves, palette, verticalScale);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const transformed: number[] = [];
    for (let i = 0; i < buffers.positions.length; i += 3) {
      const x = buffers.positions[i];
      const y = buffers.positions[i + 1];
      transformed.push(
        placement.x + drift.x + x * cosine - y * sine,
        placement.y + drift.y + x * sine + y * cosine,
      );
    }

    const expected: number[] = [];
    for (const leaf of leaves) {
      const center = {
        x: placement.x + leaf.offsetX * cosine - leaf.offsetY * sine + drift.x,
        y: placement.y + leaf.offsetX * sine + leaf.offsetY * cosine + drift.y,
      };
      const angle = leaf.angle + rotation;
      expected.push(...worldLeafTriangles(center, leaf.radius, angle));
      if (leaf.paired) {
        expected.push(
          ...worldLeafTriangles(
            {
              x: center.x + Math.cos(angle + 0.8) * leaf.radius * 0.92,
              y: center.y + Math.sin(angle + 0.8) * leaf.radius * 0.92,
            },
            leaf.radius * 0.72,
            angle + 1.15,
          ),
        );
      }
    }

    expect(transformed).toHaveLength(expected.length);
    for (const [index, value] of expected.entries()) {
      expect(Math.abs(transformed[index] - value)).toBeLessThan(1e-6);
    }
  });

  it("emits highlights only for large leaves, in the same place", () => {
    const buffers = buildDuckweedPatchBuffers(leaves, palette, verticalScale);
    // Radius 1.2 is below the 1.55 threshold; each highlight is a small fan.
    expect(buffers.highlightPositions).toHaveLength(2 * DUCKWEED_HIGHLIGHT_SEGMENTS * 3 * 3);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const leaf = leaves[0];
    const center = {
      x: placement.x + leaf.offsetX * cosine - leaf.offsetY * sine + drift.x,
      y: placement.y + leaf.offsetX * sine + leaf.offsetY * cosine + drift.y,
    };
    const angle = leaf.angle + rotation;
    const expectedX = center.x - Math.cos(angle) * leaf.radius * 0.18;
    const expectedY = center.y - Math.sin(angle) * leaf.radius * 0.18;
    // The first vertex of each highlight fan is its center.
    const x = buffers.highlightPositions[0];
    const y = buffers.highlightPositions[1];
    expect(
      Math.abs(placement.x + drift.x + x * cosine - y * sine - expectedX),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(placement.y + drift.y + x * sine + y * cosine - expectedY),
    ).toBeLessThan(1e-6);
    expect(buffers.highlightColors.slice(0, 3)).toEqual([
      palette.center.r,
      palette.center.g,
      palette.center.b,
    ]);
  });

  it("uses matching position and color counts and tone-based colors", () => {
    const buffers = buildDuckweedPatchBuffers(leaves, palette, verticalScale);
    expect(buffers.colors).toHaveLength(buffers.positions.length);
    // Leaf 0 is base tone, leaf 1 is light (tone < 0.24).
    const perLeaf = DUCKWEED_LEAF_SEGMENTS * 3 * 3;
    expect(buffers.colors.slice(0, 3)).toEqual([
      palette.base.r,
      palette.base.g,
      palette.base.b,
    ]);
    const leaf1Start = perLeaf * 2; // leaf 0 + its pair
    expect(buffers.colors.slice(leaf1Start, leaf1Start + 3)).toEqual([
      palette.light.r,
      palette.light.g,
      palette.light.b,
    ]);
  });

  it("gives every vertex of a leaf, its pair and its highlight the parent leaf's center and spin sign", () => {
    const buffers = buildDuckweedPatchBuffers(leaves, palette, verticalScale);
    const perLeaf = DUCKWEED_LEAF_SEGMENTS * 3;
    const vertexCount = buffers.positions.length / 3;
    expect(buffers.leafCenters).toHaveLength(vertexCount * 2);
    expect(buffers.leafSigns).toHaveLength(vertexCount);

    // Leaf 0 + pair, leaf 1, leaf 2 + pair.
    const owners = [0, 0, 1, 2, 2];
    for (const [block, leafIndex] of owners.entries()) {
      for (let v = block * perLeaf; v < (block + 1) * perLeaf; v += 1) {
        expect(buffers.leafCenters[v * 2]).toBe(leaves[leafIndex].offsetX);
        expect(buffers.leafCenters[v * 2 + 1]).toBe(leaves[leafIndex].offsetY);
        expect(buffers.leafSigns[v]).toBe(leaves[leafIndex].spinSign);
      }
    }

    // Highlights exist for leaves 0 and 2 only.
    const perHighlight = DUCKWEED_HIGHLIGHT_SEGMENTS * 3;
    expect(buffers.highlightLeafCenters).toHaveLength(perHighlight * 2 * 2);
    for (const [block, leafIndex] of [0, 2].entries()) {
      for (let v = block * perHighlight; v < (block + 1) * perHighlight; v += 1) {
        expect(buffers.highlightLeafCenters[v * 2]).toBe(leaves[leafIndex].offsetX);
        expect(buffers.highlightLeafCenters[v * 2 + 1]).toBe(leaves[leafIndex].offsetY);
        expect(buffers.highlightLeafSigns[v]).toBe(leaves[leafIndex].spinSign);
      }
    }
  });

  it("defaults the spin sign to 1", () => {
    const { spinSign: _ignored, ...bare } = leaves[1];
    const buffers = buildDuckweedPatchBuffers([bare], palette, verticalScale);
    expect(new Set(buffers.leafSigns)).toEqual(new Set([1]));
  });

  it("merges patches in order with patch indices and per-patch vertex offsets", () => {
    const patches = [
      { leaves: leaves.slice(0, 2), palette },
      { leaves: [], palette },
      { leaves, palette },
    ];
    const merged = buildDuckweedBuffers(patches, verticalScale);
    const built = patches.map((p) => buildDuckweedPatchBuffers(p.leaves, p.palette, verticalScale));

    const leafCounts = built.map((b) => b.positions.length / 3);
    expect(merged.leaf.patchVertexOffsets).toEqual([
      0,
      leafCounts[0],
      leafCounts[0] + leafCounts[1],
      leafCounts[0] + leafCounts[1] + leafCounts[2],
    ]);
    const highlightCounts = built.map((b) => b.highlightPositions.length / 3);
    expect(merged.highlight.patchVertexOffsets[3]).toBe(
      highlightCounts[0] + highlightCounts[1] + highlightCounts[2],
    );

    expect(Array.from(merged.leaf.positions)).toEqual(
      built.flatMap((b) => b.positions.map(Math.fround)),
    );
    expect(Array.from(merged.leaf.leafCenters)).toEqual(
      built.flatMap((b) => b.leafCenters.map(Math.fround)),
    );
    expect(Array.from(merged.highlight.leafCenters)).toEqual(
      built.flatMap((b) => b.highlightLeafCenters.map(Math.fround)),
    );

    const indices = Array.from(merged.leaf.patchIndices);
    expect(indices).toHaveLength(leafCounts[0] + leafCounts[2]);
    expect(indices.slice(0, leafCounts[0]).every((i) => i === 0)).toBe(true);
    expect(indices.slice(leafCounts[0]).every((i) => i === 2)).toBe(true);
    const highlightIndices = Array.from(merged.highlight.patchIndices);
    expect(highlightIndices.slice(0, highlightCounts[0]).every((i) => i === 0)).toBe(true);
    expect(highlightIndices.slice(highlightCounts[0]).every((i) => i === 2)).toBe(true);
  });
});

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("duckweed vertex transform mirror", () => {
  it("reproduces the old per-mesh position + rotation.z transform", () => {
    const random = seeded(1234);
    for (let i = 0; i < 200; i += 1) {
      const patch = {
        x: random() * 480,
        y: random() * 270,
        rotation: (random() - 0.5) * 0.4,
      };
      const local = { x: (random() - 0.5) * 80, y: (random() - 0.5) * 80 };
      const shadowOffset = { x: random() * 4, y: random() * 8 };

      const mesh = new Mesh();
      mesh.position.set(patch.x, patch.y, 0);
      mesh.rotation.z = patch.rotation;
      mesh.updateMatrix();
      const expected = mesh.localToWorld(mesh.position.clone().set(local.x, local.y, 0));
      const world = duckweedVertexWorld(local.x, local.y, patch);
      expect(Math.abs(world.x - expected.x)).toBeLessThan(1e-6);
      expect(Math.abs(world.y - expected.y)).toBeLessThan(1e-6);

      const shadowMesh = new Mesh();
      shadowMesh.position.set(patch.x + shadowOffset.x, patch.y + shadowOffset.y, 0);
      shadowMesh.rotation.z = patch.rotation;
      shadowMesh.updateMatrix();
      const expectedShadow = shadowMesh.localToWorld(shadowMesh.position.clone().set(local.x, local.y, 0));
      const shadow = duckweedVertexWorld(local.x, local.y, patch, { shadowOffset });
      expect(Math.abs(shadow.x - expectedShadow.x)).toBeLessThan(1e-6);
      expect(Math.abs(shadow.y - expectedShadow.y)).toBeLessThan(1e-6);
    }
  });

  it("ignores zero ripples entirely", () => {
    const patch = { x: 10, y: 20, rotation: 0.03 };
    const tuning: DuckweedRippleTuning = {
      strength: 2.5, bandWidth: 7, falloffDistance: 35, maxPush: 3.5, spin: 0.35,
    };
    const plain = duckweedVertexWorld(3, -2, patch);
    const withEmpty = duckweedVertexWorld(3, -2, patch, {
      leafCenter: { x: 3, y: -2 },
      leafSign: 1,
      ripples: [],
      tuning,
    });
    expect(withEmpty).toEqual(plain);
  });
});

describe("duckweed ripple displacement mirror", () => {
  const tuning: DuckweedRippleTuning = {
    strength: 2.5, bandWidth: 7, falloffDistance: 35, maxPush: 3.5, spin: 0.35,
  };
  const ripple: DuckweedRipple = {
    x: 100, y: 100, age: 0, strength: 1, lifetime: 2.2, startRadius: 4, expansionSpeed: 62,
  };

  // Peak outward push of a leaf at `distance` from the ripple (along +x) over its lifetime.
  function peakPush(distance: number): number {
    let peak = 0;
    for (let age = 0; age < ripple.lifetime; age += 0.002) {
      const { pushX } = duckweedRippleDisplacement(100 + distance, 100, [{ ...ripple, age }], {
        ...tuning,
        maxPush: 100,
      });
      peak = Math.max(peak, pushX);
    }
    return peak;
  }

  it("produces no displacement without ripples", () => {
    expect(duckweedRippleDisplacement(120, 90, [], tuning)).toEqual({ pushX: 0, pushY: 0, spin: 0 });
  });

  it("pushes near leaves harder than far leaves", () => {
    expect(peakPush(15)).toBeGreaterThan(peakPush(60));
    expect(peakPush(60)).toBeGreaterThan(0);
  });

  it("pushes outward as the ring arrives and back inward after it passes, then settles", () => {
    const distance = 40;
    const at = (age: number) =>
      duckweedRippleDisplacement(100 + distance, 100, [{ ...ripple, age }], tuning);
    const arrival = (distance - ripple.startRadius) / ripple.expansionSpeed;
    expect(at(arrival - 0.06).pushX).toBeGreaterThan(0.2);
    expect(Math.abs(at(arrival).pushX)).toBeLessThan(1e-9);
    expect(at(arrival + 0.06).pushX).toBeLessThan(-0.2);
    expect(Math.abs(at(arrival + 0.6).pushX)).toBeLessThan(1e-6);
    // Ripple direction only: no push perpendicular to the ring.
    expect(at(arrival - 0.06).pushY).toBe(0);
    // Long after the ring passed (and past its lifetime) the leaf is back.
    const late = at(ripple.lifetime + 1);
    expect(late).toEqual({ pushX: 0, pushY: 0, spin: 0 });
  });

  it("clamps the total push to maxPush", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...ripple, age: 0.55 - i * 0.001, strength: 2 }));
    const { pushX, pushY } = duckweedRippleDisplacement(140, 100, many, { ...tuning, maxPush: 1 });
    expect(Math.hypot(pushX, pushY)).toBeCloseTo(1, 9);
  });

  it("rotates the leaf's vertices around its world center by spin * leafSign", () => {
    const patch = { x: 0, y: 0, rotation: 0 };
    const leafCenter = { x: 140, y: 100 };
    const arrival = (40 - ripple.startRadius) / ripple.expansionSpeed;
    const ripples = [{ ...ripple, age: arrival }];
    const at = (sign: number) =>
      duckweedVertexWorld(leafCenter.x + 2, leafCenter.y, patch, {
        leafCenter,
        leafSign: sign,
        ripples,
        tuning: { ...tuning, maxPush: 0 },
      });
    // Zero push at the crest, pure spin around the center: the vertex stays 2 px away.
    const plus = at(1);
    const minus = at(-1);
    expect(Math.hypot(plus.x - leafCenter.x, plus.y - leafCenter.y)).toBeCloseTo(2, 9);
    expect(plus.y - leafCenter.y).toBeGreaterThan(0);
    expect(minus.y - leafCenter.y).toBeLessThan(0);
  });
});
