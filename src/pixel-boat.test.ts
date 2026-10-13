import { describe, expect, it } from "vitest";
import {
  PixelBoat,
  BOAT_BASE_WIDTH,
  BOAT_BASE_HEIGHT,
} from "./pixel-boat";
import { vec, add } from "./math";

describe("PixelBoat", () => {
  it("initializes with default options and valid base dimensions", () => {
    const boat = new PixelBoat();
    expect(boat.options.scale).toBe(1.0);
    expect(BOAT_BASE_WIDTH).toBeCloseTo(64.0, 1);
    expect(BOAT_BASE_HEIGHT).toBeCloseTo(42.0, 1);
    expect(boat.state).toBe("orbiting");
    expect(boat.group.visible).toBe(true);
    expect(boat.shadowGroup.visible).toBe(true);
    boat.dispose();
  });

  it("clamps and updates scale correctly, hiding boat at scale 0", () => {
    const boat = new PixelBoat();
    boat.setScale(1.5);
    expect(boat.options.scale).toBe(1.5);
    expect(boat.group.visible).toBe(true);

    boat.setScale(0);
    expect(boat.options.scale).toBe(0);
    expect(boat.group.visible).toBe(false);
    expect(boat.shadowGroup.visible).toBe(false);

    // Hit test should always return null when scale is 0
    expect(boat.hitTest(boat.options.position)).toBeNull();

    boat.setScale(2.5); // should clamp to 2.0
    expect(boat.options.scale).toBe(2.0);
    expect(boat.group.visible).toBe(true);
    boat.dispose();
  });

  it("correctly identifies vintage music player compartment and food tray", () => {
    const boat = new PixelBoat();
    boat.setScale(1.0);
    boat.facingLeft = true;
    const center = boat.options.position;

    // Point in music player compartment (bow side: localX < 0)
    const musicPoint = add(center, vec(-BOAT_BASE_WIDTH * 0.25, 0));
    expect(boat.hitTest(musicPoint)).toBe("music");

    // Point in food feeder compartment (stern side: localX > 0)
    const foodPoint = add(center, vec(BOAT_BASE_WIDTH * 0.25, 0));
    expect(boat.hitTest(foodPoint)).toBe("food");

    // Point far away from the boat
    const outsidePoint = add(center, vec(100, 100));
    expect(boat.hitTest(outsidePoint)).toBeNull();

    boat.dispose();
  });

  it("handles dragging and returning to orbit around the clock", () => {
    const boat = new PixelBoat();
    const clockCenter = boat.orbitCenter;

    // Drag boat to corner
    const dragPos = vec(50, 50);
    boat.startDrag(dragPos);
    expect(boat.state).toBe("dragging");
    expect(boat.options.position.x).toBe(50);
    expect(boat.options.position.y).toBe(50);

    // Release drag
    boat.endDrag();
    expect(boat.state).toBe("returning");

    // Step simulation until boat returns to orbit
    for (let t = 0; t < 10.0; t += 0.016) {
      boat.update(t, null, "sunny", undefined, clockCenter);
      if (boat.state === "orbiting") break;
    }

    // Should have returned to orbiting around the clock
    expect(boat.state).toBe("orbiting");

    // Distance to clock center should match orbital radius
    const dx = (boat.options.position.x - clockCenter.x) / boat.orbitRadiusX;
    const dy = (boat.options.position.y - clockCenter.y) / boat.orbitRadiusY;
    expect(Math.hypot(dx, dy)).toBeCloseTo(1.0, 1);

    boat.dispose();
  });

  it("handles music playing state toggling", () => {
    const boat = new PixelBoat();
    expect(boat.getMusicPlaying()).toBe(false);

    boat.setMusicPlaying(true);
    expect(boat.getMusicPlaying()).toBe(true);

    boat.setMusicPlaying(false);
    expect(boat.getMusicPlaying()).toBe(false);

    boat.dispose();
  });

  it("spawns ballistic food pellets on dropFoodPellets", () => {
    const boat = new PixelBoat();
    const targetPos = add(boat.options.position, vec(20, 20));

    expect(boat.getPellets().length).toBe(0);
    boat.dropFoodPellets(targetPos);
    expect(boat.getPellets().length).toBeGreaterThanOrEqual(3);

    const firstPellet = boat.getPellets()[0];
    expect(firstPellet.state).toBe("air");
    expect(firstPellet.z).toBeGreaterThan(0);
    expect(firstPellet.vz).toBeGreaterThan(0);

    boat.dispose();
  });

  it("performs hydrodynamic wave updates without errors", () => {
    const boat = new PixelBoat();
    boat.setMusicPlaying(true);

    // Run several simulation steps
    for (let t = 0; t < 2.0; t += 0.016) {
      boat.update(t, null, "sunset");
    }

    // Music notes should have been generated over 2 seconds
    expect(boat.getNotes().length).toBeGreaterThan(0);

    boat.dispose();
  });

  it("handles speed multiplier configuration and clamping", () => {
    const boat = new PixelBoat();
    expect(boat.getSpeedMultiplier()).toBe(1.0);

    boat.setSpeedMultiplier(1.8);
    expect(boat.getSpeedMultiplier()).toBe(1.8);

    boat.setSpeedMultiplier(5.0); // should clamp to 3.0
    expect(boat.getSpeedMultiplier()).toBe(3.0);

    boat.setSpeedMultiplier(-1.0); // should clamp to 0.0
    expect(boat.getSpeedMultiplier()).toBe(0.0);

    boat.dispose();
  });

  it("synchronizes with external system audio and media session playback", () => {
    const boat = new PixelBoat();
    expect(boat.isAnyMusicPlaying()).toBe(false);

    // Audio listener activates
    boat.setSystemAudioPlaying(true, 0.45);
    expect(boat.isAnyMusicPlaying()).toBe(true);

    boat.setSystemAudioPlaying(false);
    expect(boat.isAnyMusicPlaying()).toBe(false);

    // Media session activates
    boat.setMediaSessionPlaying(true);
    expect(boat.isAnyMusicPlaying()).toBe(true);

    // Button feedback triggers
    boat.triggerButtonFeedback("play");
    boat.setTrackMetadata("Test Track", "Test Artist");
    expect(boat.getTrackName()).toBe("Test Track - Test Artist");

    boat.dispose();
  });

  it("keeps food pellets floating without disappearing prematurely", () => {
    const boat = new PixelBoat();
    const targetPos = vec(200, 150);
    boat.dropFoodPellets(targetPos);

    expect(boat.getPellets().length).toBeGreaterThan(0);

    // Simulate 600 frames (~9.6s simulation time with fixed dt = 0.016)
    for (let f = 0; f < 600; f++) {
      boat.update(f * 0.016);
    }

    // Pellets must still be alive and floating on the water surface waiting for fish
    const pellets = boat.getPellets();
    expect(pellets.length).toBeGreaterThan(0);
    for (const p of pellets) {
      expect(p.state).toBe("floating");
      expect(p.age).toBeCloseTo(600 * 0.016, 0.5);
    }

    boat.dispose();
  });

  it("consumes food pellet only when koi approaches mouth distance, triggering gulp animation and ripple", () => {
    const boat = new PixelBoat();
    const targetPos = vec(200, 150);
    boat.dropFoodPellets(targetPos);

    // Step 70 frames (~1.12s) until ballistic pellets hit water surface and float
    for (let f = 0; f < 70; f++) {
      boat.update(f * 0.016);
    }

    const countBefore = boat.getPellets().length;
    expect(countBefore).toBeGreaterThan(0);
    const targetPellet = boat.getPellets()[0];
    expect(targetPellet.state).toBe("floating");

    const triggeredRipples: string[] = [];
    const mockRipples = {
      trigger: (type: string) => {
        triggeredRipples.push(type);
      },
    } as any;

    // 1. Koi far away should NOT eat the pellet
    const farKoi = {
      position: vec(50, 50),
      heading: 0,
      bodyWidth: 12,
      depth: 0.1,
      gulpAnimation: 0,
      gulpCountdown: 5,
    } as any;

    boat.update(1.2, mockRipples, "sunny", undefined, null, undefined, [farKoi]);
    expect(boat.getPellets().length).toBe(countBefore);
    expect(farKoi.gulpAnimation).toBe(0);

    // 2. Deep koi directly underneath (depth = 0.85) should NOT eat surface pellet
    const deepKoi = {
      position: vec(targetPellet.x, targetPellet.y),
      heading: 0,
      bodyWidth: 12,
      depth: 0.85,
      gulpAnimation: 0,
      gulpCountdown: 5,
    } as any;

    boat.update(1.3, mockRipples, "sunny", undefined, null, undefined, [deepKoi]);
    expect(boat.getPellets().length).toBe(countBefore);
    expect(deepKoi.gulpAnimation).toBe(0);

    // 3. Surface koi approaching closely to bite
    const closeKoi = {
      position: vec(targetPellet.x - 4, targetPellet.y),
      heading: 0, // Facing right, straight towards the pellet
      bodyWidth: 12,
      depth: 0.12,
      gulpAnimation: 0,
      gulpCountdown: 5,
    } as any;

    boat.update(1.4, mockRipples, "sunny", undefined, null, undefined, [closeKoi]);

    // Pellet must be consumed!
    expect(boat.getPellets().length).toBeLessThan(countBefore);
    expect(closeKoi.gulpAnimation).toBeGreaterThan(0);
    expect(triggeredRipples).toContain("mouth");

    boat.dispose();
  });

  it("produces Kelvin wake nodes and foam particles through wakeTrail during cruising", () => {
    const boat = new PixelBoat();
    expect(boat.wakeTrail.getNodes().length).toBe(0);

    // Step several frames of orbiting motion
    for (let t = 0; t < 1.0; t += 0.05) {
      boat.update(t, null, "sunny");
    }

    expect(boat.wakeTrail.getNodes().length).toBeGreaterThan(0);
    expect(boat.wakeTrail.mesh.visible).toBe(true);
    boat.dispose();
  });

  it("handles mini anchor dropping, deceleration to stop, and hauling back up", () => {
    const boat = new PixelBoat();
    expect(boat.isAnchored()).toBe(false);
    expect(boat.anchorState).toBe("stowed");
    expect(boat.anchorDropProgress).toBe(0.0);

    // Hit-test bow prow anchor zone
    boat.facingLeft = true;
    const anchorPoint = add(boat.options.position, vec(-BOAT_BASE_WIDTH * 0.40, 0));
    expect(boat.hitTest(anchorPoint)).toBe("anchor");

    // Drop anchor
    let splashCalled = false;
    const dropToggled = boat.toggleAnchor(() => {
      splashCalled = true;
    });
    expect(dropToggled).toBe(true);
    expect(boat.anchorState).toBe("dropping");

    // Advance time through drop animation (~1.0s)
    for (let t = 0; t < 1.2; t += 0.016) {
      boat.update(t, null, "sunny");
    }

    // Must be fully anchored and stopped
    expect(splashCalled).toBe(true);
    expect(boat.isAnchored()).toBe(true);
    expect(boat.anchorState).toBe("anchored");
    expect(boat.state).toBe("anchored");
    expect(boat.anchorDropProgress).toBe(1.0);

    // Position should be frozen across subsequent frames
    const anchoredPos = { ...boat.options.position };
    for (let t = 1.2; t < 2.5; t += 0.016) {
      boat.update(t, null, "sunny");
    }
    expect(boat.options.position.x).toBeCloseTo(anchoredPos.x, 3);
    expect(boat.options.position.y).toBeCloseTo(anchoredPos.y, 3);

    // Haul anchor back up
    const haulToggled = boat.toggleAnchor();
    expect(haulToggled).toBe(false);
    expect(boat.anchorState).toBe("hauling");

    // Advance time through haul animation (~0.8s)
    for (let t = 2.5; t < 3.5; t += 0.016) {
      boat.update(t, null, "sunny");
    }

    // Must be stowed and back to orbiting
    expect(boat.isAnchored()).toBe(false);
    expect(boat.anchorState).toBe("stowed");
    expect(boat.state).toBe("orbiting");
    expect(boat.anchorDropProgress).toBe(0.0);

    // Should resume moving along orbit
    const nextPos = { ...boat.options.position };
    boat.update(3.6, null, "sunny");
    expect(boat.options.position.x !== nextPos.x || boat.options.position.y !== nextPos.y).toBe(true);

    boat.dispose();
  });
});
