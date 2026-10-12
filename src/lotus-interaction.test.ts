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

  it("glides outward along with the traveling wave when a user click ripple passes, then relaxes back", () => {
    const lotus = new LotusLeavesPass();
    lotus.update(0);

    const leafCenter = (lotus as any).leafCenters[0];
    // Place a touch ripple 60px to the left of the leaf
    const rippleOriginX = leafCenter.x - 60;
    const rippleOriginY = leafCenter.y;

    // A touch ripple expands at speed 62 px/s.
    // At age ~0.9s, radius = 4 + 62 * 0.9 = 59.8px, hitting the leaf from the left.
    const ripple: RippleInstance = {
      center: { x: rippleOriginX, y: rippleOriginY },
      age: 0.9,
      strength: 1.0,
      type: "touch",
      alive: true,
    };

    // Simulate wave propagation from t=0.7 to t=1.4 as wave sweeps across the leaf
    for (let t = 0.7; t <= 1.4; t += 0.05) {
      ripple.age = t;
      lotus.update(t, [ripple]);
    }

    const dynGlided = (lotus as any).leafDynamics[0];
    // The leaf should have glided noticeably to the right along with the wave
    expect(dynGlided.pushX).toBeGreaterThan(1.5);
    expect(dynGlided.pushVelX).toBeGreaterThan(0);

    // Advance time until the wave passes and the leaf lazily glides back to rest
    for (let t = 1.45; t <= 5.5; t += 0.05) {
      lotus.update(t, []);
    }

    const dynSettled = (lotus as any).leafDynamics[0];
    expect(Math.abs(dynSettled.pushX)).toBeLessThan(0.2);
    expect(Math.abs(dynSettled.pushVelX)).toBeLessThan(0.2);
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
