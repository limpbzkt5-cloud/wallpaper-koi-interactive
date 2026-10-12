import { describe, expect, it } from "vitest";
import { LotusLeavesPass } from "./lotus-leaves";
import { TinyFishSchools, TinyFishSpecies } from "./tiny-fish";
import type { RippleInstance } from "./ripple-system";

describe("LotusLeavesPass interactive ripple dynamic response", () => {
  it("bobs up when a touch ripple expands and intersects the leaf, then settles back", () => {
    const lotus = new LotusLeavesPass();

    // Initial update with no ripples
    lotus.update(0);
    const initialScale = (lotus as any).leaves[0].group.scale.x;

    // Simulate a touch ripple located right at leaf 0 position
    const leafCenter = (lotus as any).leafCenters[0];
    const ripple: RippleInstance = {
      center: { x: leafCenter.x, y: leafCenter.y },
      age: 0.05,
      strength: 1.0,
      type: "touch",
      alive: true,
    };

    // Update with the ripple wave hitting the leaf
    lotus.update(0.05, [ripple]);
    const bobbedScale = (lotus as any).leaves[0].group.scale.x;

    // The leaf should have lifted up (scale increased due to buoyant lift)
    expect(bobbedScale).toBeGreaterThan(initialScale);

    // Continue updating over time with ripple gone to verify harmonic settling
    for (let t = 0.1; t <= 3.0; t += 0.05) {
      lotus.update(t, []);
    }

    const settledScale = (lotus as any).leaves[0].group.scale.x;
    const dyn = (lotus as any).leafDynamics[0];

    // The leaf dynamic state bob should have damped back towards 0
    expect(dyn.bob).toBeLessThan(0.05);
    expect(Math.abs(settledScale - initialScale)).toBeLessThan(0.05);
  });
});

describe("TinyFishSchools species diversity & ambient background constraints", () => {
  it("assigns distinct species across schools", () => {
    const schools = new TinyFishSchools();
    expect(schools.fish.length).toBeGreaterThan(0);

    const speciesSet = new Set(schools.fish.map((f) => f.species));
    // Verify species are assigned
    expect(speciesSet.has(TinyFishSpecies.Medaka)).toBe(true);
    expect(speciesSet.has(TinyFishSpecies.NeonDanio)).toBe(true);
    expect(speciesSet.has(TinyFishSpecies.RosyBitterling)).toBe(true);
    expect(speciesSet.has(TinyFishSpecies.EmeraldRasbora)).toBe(true);
  });

  it("strictly enforces ambient background scale so tiny fish never dominate the koi", () => {
    const schools = new TinyFishSchools();
    for (const fish of schools.fish) {
      // Must remain tiny background minnows (bodyLength < 12px, bodyWidth < 4px)
      expect(fish.bodyLength).toBeLessThan(12.0);
      expect(fish.bodyLength).toBeGreaterThan(3.0);
      expect(fish.bodyWidth).toBeLessThan(4.5);
      expect(fish.bodyWidth).toBeGreaterThan(0.5);
    }
  });
});
