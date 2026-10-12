import { describe, expect, it } from "vitest";
import { PondClock, DEFAULT_CLOCK_OPTIONS } from "./pond-clock";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./config";

describe("PondClock", () => {
  it("initializes with default options and valid Three.js mesh", () => {
    const clock = new PondClock();
    expect(clock.options.enabled).toBe(true);
    expect(clock.options.mode).toBe("submerged");
    expect(clock.options.format).toBe("24h");
    expect(clock.options.showSeconds).toBe(false);
    expect(clock.options.opacity).toBe(DEFAULT_CLOCK_OPTIONS.opacity);
    expect(clock.mesh.visible).toBe(true);
    expect(clock.mesh.scale.y).toBe(-1); // Inverted Y-scale for right-side up text
    expect(clock.mesh.position.x).toBeCloseTo(CANVAS_WIDTH * 0.5);
    expect(clock.mesh.position.y).toBeCloseTo(CANVAS_HEIGHT * 0.48);
    clock.dispose();
  });

  it("switches modes between submerged, floating, and off correctly", () => {
    const clock = new PondClock();
    clock.setMode("floating");
    expect(clock.options.mode).toBe("floating");
    expect(clock.options.enabled).toBe(true);

    clock.setMode("submerged");
    expect(clock.options.mode).toBe("submerged");
    expect(clock.options.enabled).toBe(true);

    clock.setMode("off");
    expect(clock.options.mode).toBe("off");
    expect(clock.options.enabled).toBe(false);
    expect(clock.mesh.visible).toBe(false);
    clock.dispose();
  });

  it("handles enabling and disabling clock cleanly", () => {
    const clock = new PondClock();
    clock.setEnabled(false);
    expect(clock.options.enabled).toBe(false);
    expect(clock.mesh.visible).toBe(false);

    clock.setEnabled(true);
    expect(clock.options.enabled).toBe(true);
    expect(clock.mesh.visible).toBe(true);
    clock.dispose();
  });

  it("updates position based on alignment options", () => {
    const clock = new PondClock();
    clock.setPosition("top-right");
    expect(clock.mesh.position.x).toBeCloseTo(CANVAS_WIDTH * 0.74);
    expect(clock.mesh.position.y).toBeCloseTo(CANVAS_HEIGHT * 0.22);

    clock.setPosition("top-left");
    expect(clock.mesh.position.x).toBeCloseTo(CANVAS_WIDTH * 0.26);
    expect(clock.mesh.position.y).toBeCloseTo(CANVAS_HEIGHT * 0.22);

    clock.setPosition("bottom-center");
    expect(clock.mesh.position.x).toBeCloseTo(CANVAS_WIDTH * 0.5);
    expect(clock.mesh.position.y).toBeCloseTo(CANVAS_HEIGHT * 0.80);

    clock.setPosition("center");
    expect(clock.mesh.position.x).toBeCloseTo(CANVAS_WIDTH * 0.5);
    expect(clock.mesh.position.y).toBeCloseTo(CANVAS_HEIGHT * 0.48);
    clock.dispose();
  });

  it("clamps opacity within valid range [0.05, 1.0]", () => {
    const clock = new PondClock();
    clock.setOpacity(1.5);
    expect(clock.options.opacity).toBe(1.0);

    clock.setOpacity(-0.5);
    expect(clock.options.opacity).toBe(0.05);

    clock.setOpacity(0.45);
    expect(clock.options.opacity).toBe(0.45);
    clock.dispose();
  });

  it("formats time and updates without errors across weather presets", () => {
    const clock = new PondClock();
    clock.setEnabled(true);
    const date = new Date("2026-10-12T19:08:45");

    clock.setFormat("24h");
    clock.setShowSeconds(true);
    clock.update(date, "sunny");

    clock.setFormat("12h");
    clock.update(date, "moonlight");

    clock.update(date, "sunset");
    clock.update(date, "mist");

    expect(clock.mesh.visible).toBe(true);
    clock.dispose();
  });

  it("updates fluid wave time and ripple wave uniforms cleanly", () => {
    const clock = new PondClock();
    clock.setEnabled(true);
    const date = new Date("2026-10-12T19:08:45");
    const mockRipples = {
      instances: [
        { alive: true, age: 0.5, strength: 1.2, center: { x: 240, y: 130 } },
        { alive: false, age: 1.0, strength: 0.8, center: { x: 100, y: 100 } },
      ],
    } as any;

    clock.update(date, "sunny", 5.2, mockRipples);
    // Mesh should exhibit subtle organic buoyancy wave sway
    expect(clock.mesh.position.x).not.toBe(clock.basePosition.x);
    expect(clock.mesh.position.y).not.toBe(clock.basePosition.y);
    clock.dispose();
  });
});
