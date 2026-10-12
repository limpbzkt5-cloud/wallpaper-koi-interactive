import { describe, expect, it } from "vitest";
import { BoatWakeTrail } from "./boat-wake";
import { vec } from "./math";

describe("BoatWakeTrail", () => {
  it("initializes with empty nodes and valid geometry attributes", () => {
    const trail = new BoatWakeTrail();
    expect(trail.getNodes().length).toBe(0);
    expect(trail.getFoamParticles().length).toBe(0);
    expect(trail.mesh).toBeDefined();
    expect(trail.geometry.getAttribute("position")).toBeDefined();
    expect(trail.geometry.getAttribute("color")).toBeDefined();
    expect(trail.geometry.getAttribute("uv")).toBeDefined();
    trail.dispose();
  });

  it("does not emit wake nodes when boat is stationary", () => {
    const trail = new BoatWakeTrail();
    trail.update(
      0.016,
      vec(100, 100),
      vec(120, 100),
      vec(80, 100),
      vec(0, 0), // Zero velocity
      1.0,
      "sunny",
    );
    expect(trail.getNodes().length).toBe(0);
    expect(trail.getFoamParticles().length).toBe(0);
    trail.dispose();
  });

  it("emits wake nodes and foam particles when boat is moving", () => {
    const trail = new BoatWakeTrail();
    // Simulate motion over a few frames
    for (let i = 0; i < 5; i++) {
      trail.update(
        0.016,
        vec(100 + i * 5, 100),
        vec(120 + i * 5, 100),
        vec(80 + i * 5, 100),
        vec(25, 0), // Moving at 25 units/s
        1.0,
        "sunny",
      );
    }
    expect(trail.getNodes().length).toBeGreaterThan(0);
    expect(trail.getFoamParticles().length).toBeGreaterThan(0);
    trail.dispose();
  });

  it("ages and prunes wake nodes and foam particles over time", () => {
    const trail = new BoatWakeTrail();
    trail.update(
      0.016,
      vec(100, 100),
      vec(120, 100),
      vec(80, 100),
      vec(20, 0),
      1.0,
      "sunny",
    );
    expect(trail.getNodes().length).toBe(1);

    // Fast-forward time past maxAge (2.5 seconds)
    trail.update(
      3.0,
      vec(100, 100),
      vec(120, 100),
      vec(80, 100),
      vec(0, 0),
      1.0,
      "sunny",
    );
    expect(trail.getNodes().length).toBe(0);
    expect(trail.getFoamParticles().length).toBe(0);
    trail.dispose();
  });

  it("clears all wake data when scale is 0 or clear() is called", () => {
    const trail = new BoatWakeTrail();
    trail.update(
      0.016,
      vec(100, 100),
      vec(120, 100),
      vec(80, 100),
      vec(20, 0),
      1.0,
      "sunny",
    );
    expect(trail.getNodes().length).toBe(1);

    trail.update(
      0.016,
      vec(105, 100),
      vec(125, 100),
      vec(85, 100),
      vec(20, 0),
      0.0, // Scale 0
      "sunny",
    );
    expect(trail.getNodes().length).toBe(0);
    trail.dispose();
  });
});
