import { describe, expect, it } from "vitest";
import { defaults, nodeAt, validate, walkLeaves } from "./schema";
import { definition } from "./definition";

describe("schema defaults", () => {
  it("keeps every default strictly inside its declared bounds", () => {
    const problems: string[] = [];
    walkLeaves(definition, (node, path) => {
      const key = path.join(".");
      switch (node.kind) {
        case "num":
          if (node.default < node.min || node.default > node.max) problems.push(key);
          break;
        case "range":
          if (
            node.default[0] < node.min || node.default[0] > node.max ||
            node.default[1] < node.min || node.default[1] > node.max ||
            node.default[0] > node.default[1]
          ) problems.push(key);
          break;
        case "vec2":
          if (node.default.some((v) => v < node.min || v > node.max)) problems.push(key);
          break;
        case "rgb": {
          const min = node.min ?? 0;
          const max = node.max ?? 2;
          if (node.default.some((v) => v < min || v > max)) problems.push(key);
          break;
        }
        case "choice":
          if (!node.options.some((o) => o.value === node.default)) problems.push(key);
          break;
        default:
          break;
      }
    });
    expect(problems).toEqual([]);
  });

  it("builds a full default tree with the expected top-level sections", () => {
    const value = defaults(definition) as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(
      [
        "koi", "koi-palettes", "koi-patterns", "tiny-fish", "tiny-fish-schools",
        "pond-bed", "water", "ripples", "lotus", "lotus-leaves", "lotus-flowers",
        "duckweed", "duckweed-patches", "butterflies", "butterfly-spawns",
      ].sort(),
    );
  });

  it("spot-checks values transcribed from the old config.ts (data fixes noted)", () => {
    const value = defaults(definition) as any;
    expect(value.koi.initialCount).toBe(14);
    expect(value.koi.regularLength).toEqual([27, 40]);
    expect(value.koi.eyeColor).toBe(0x171815);
    expect(value.koi.shadow.color).toBe(0x0b211e);
    // Data fix: depth.shadow.additionalOffset moved to koi.shadow.depthOffset.
    expect(value.koi.shadow.depthOffset).toEqual({ x: -3, y: -7 });
    expect(value.koi.depth.deepBrightness).toBe(0.59);
    expect(value["koi-palettes"][0]).toEqual({
      name: "Kohaku", base: 0xf1eadb, accent: 0xdc4b2f, marking: 0x27251f, fin: 0xe6ddca,
    });
    expect(value["koi-patterns"][3]).toEqual([]);
    expect(value["tiny-fish"].visibleSchoolCount).toBe(3);
    expect(value["tiny-fish-schools"]).toHaveLength(4);
    expect(value["pond-bed"].deepColor).toEqual([0.486, 0.718, 0.631]);
    expect(value.water.currentDistortion.waves[2]).toEqual({
      direction: [0.71, 0.71], frequency: 59, speed: -6.38, strength: 0.28,
    });
    expect(value.ripples.types.mouth.distortion).toBe(10.4);
    expect(value.ripples.types.touch.intervalSeconds).toBe(0.023);
    expect(value.lotus.visibleLeafCount).toBe(15);
    // Data fix: flower #4 moved from leafIndex 15 (hidden) to 9 (visible).
    expect(value["lotus-flowers"][3].leafIndex).toBe(9);
    expect(value.duckweed.visiblePatchCount).toBe(8);
    expect(value.butterflies.visibleCount).toBe(4);
    expect(value["butterfly-spawns"]).toHaveLength(6);
  });
});

describe("validate", () => {
  it("clamps and rounds numbers", () => {
    const node = nodeAt(definition, ["koi", "initialCount"])!;
    expect(validate(node, 1000, definition)).toBe(48);
    expect(validate(node, -5, definition)).toBe(1);
    expect(validate(node, 3.6, definition)).toBe(4);
    expect(validate(node, "nope", definition)).toBeUndefined();
  });

  it("keeps koi depth ranges within 0..1 (previous bug clamped to that already, verify not wider)", () => {
    const node = nodeAt(definition, ["koi", "depth", "initialRange"])!;
    expect(validate(node, [-1, 2], definition)).toEqual([0, 1]);
    expect(validate(node, [0.3, 0.1], definition)).toEqual([0.1, 0.3]);
  });

  it("allows negative wave direction/speed and frequency up to 80 (previous bug)", () => {
    const direction = nodeAt(definition, ["water", "currentDistortion", "waves", 0, "direction"])!;
    expect(validate(direction, [-0.9, 0.4], definition)).toEqual([-0.9, 0.4]);
    const frequency = nodeAt(definition, ["water", "currentDistortion", "waves", 0, "frequency"])!;
    expect(validate(frequency, 59, definition)).toBe(59);
    const speed = nodeAt(definition, ["water", "currentDistortion", "waves", 0, "speed"])!;
    expect(validate(speed, -6.38, definition)).toBe(-6.38);
  });

  it("allows intervalSeconds below 0.1 and mouth distortion above 10 (previous bugs)", () => {
    const interval = nodeAt(definition, ["ripples", "types", "touch", "intervalSeconds"])!;
    expect(validate(interval, 0.023, definition)).toBe(0.023);
    const distortion = nodeAt(definition, ["ripples", "types", "mouth", "distortion"])!;
    expect(validate(distortion, 10.4, definition)).toBe(10.4);
  });

  it("rejects choice values outside the option list", () => {
    const node = nodeAt(definition, ["koi-patterns", 0, 0, "color"])!;
    expect(validate(node, "accent", definition)).toBe("accent");
    expect(validate(node, "nonsense", definition)).toBeUndefined();
  });

  it("clamps an index leaf to the referenced list's live length", () => {
    const node = nodeAt(definition, ["lotus-flowers", 0, "leafIndex"])!;
    const live = defaults(definition) as any;
    live["lotus-leaves"] = live["lotus-leaves"].slice(0, 3);
    expect(validate(node, 10, definition, live)).toBe(2);
  });
});
