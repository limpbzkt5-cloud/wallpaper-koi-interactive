import { describe, expect, it } from "vitest";
import { PondFaunaPass } from "./pond-fauna";
import { vec } from "./math";

describe("PondFaunaPass", () => {
  it("initializes with frog in sitting state and valid Three.js groups", () => {
    const fauna = new PondFaunaPass();
    expect(fauna.group).toBeDefined();
    expect(fauna.shadowGroup).toBeDefined();
    expect(fauna.frog.state).toBe("sitting");
    expect(fauna.frog.x).toBeGreaterThan(0);
    expect(fauna.frog.y).toBeGreaterThan(0);
    fauna.dispose();
  });

  it("handles dragonfly spawning and natural color palette indices (0-3)", () => {
    const fauna = new PondFaunaPass();
    // Simulate time until initial dragonfly spawns (spawn timer = 3.5s)
    for (let t = 0; t <= 4.0; t += 0.1) {
      fauna.update(0.1, t);
      if (fauna.getDragonflies().length > 0) break;
    }
    const dfs = fauna.getDragonflies();
    expect(dfs.length).toBeGreaterThan(0);
    for (const df of dfs) {
      expect(df.colorIdx).toBeGreaterThanOrEqual(0);
      expect(df.colorIdx).toBeLessThanOrEqual(3);
      expect(df.caught).toBe(false);
    }
    fauna.dispose();
  });

  it("catches a nearby dragonfly with tongue strike and swallows it", () => {
    const fauna = new PondFaunaPass();
    fauna.frog.state = "sitting";
    fauna.frog.x = 100;
    fauna.frog.y = 100;

    // Manually place a dragonfly within tongue strike range (20 units away)
    const dfs = fauna.getDragonflies() as any[];
    dfs.push({
      id: 999,
      x: 115,
      y: 100,
      z: 8.0,
      vx: 0,
      vy: 0,
      targetX: 115,
      targetY: 100,
      hoverTimer: 5.0,
      colorIdx: 0,
      heading: 0,
      wingPhase: 0,
      age: 1.0,
      maxAge: 30.0,
      caught: false,
    });

    const initialDfCount = dfs.length;

    // Next frame: frog should detect dragonfly and initiate tongue strike
    fauna.update(0.016, 1.0);
    expect(fauna.frog.state).toBe("tongue_strike");
    expect(fauna.frog.targetDragonfly).toBeDefined();

    // Step through tongue strike animation (0.22s)
    for (let t = 0; t < 0.3; t += 0.016) {
      fauna.update(0.016, 1.0 + t);
    }

    // Frog should have consumed dragonfly and returned to sitting with gulp timer
    expect(fauna.frog.state).toBe("sitting");
    expect(fauna.frog.gulpTimer).toBeGreaterThan(0);
    expect(fauna.getDragonflies().length).toBe(initialDfCount - 1);

    fauna.dispose();
  });

  it("scares frog when water is disturbed near its lily pad, causing dive and swim despawn", () => {
    const fauna = new PondFaunaPass();
    fauna.frog.state = "sitting";
    fauna.frog.x = 50; // Near left edge
    fauna.frog.y = 50;

    // Disturb water right near frog
    fauna.notifyWaterDisturbed(vec(55, 50), 30);
    expect(fauna.frog.state).toBe("scared_dive");

    // Step through dive animation into water (0.35s)
    for (let t = 0; t < 0.4; t += 0.016) {
      fauna.update(0.016, t);
    }
    expect(fauna.frog.state).toBe("swimming");

    // Step swimming until frog exits screen bounds and despawns
    for (let t = 0; t < 5.0; t += 0.016) {
      fauna.update(0.016, t);
      if ((fauna.frog.state as string) === "despawned") break;
    }

    expect(fauna.frog.state as string).toBe("despawned");
    expect(fauna.frog.respawnTimer).toBeGreaterThan(0);

    fauna.dispose();
  });

  it("relocates across pond to distant lily pad bundle after migration timer expires", () => {
    const fauna = new PondFaunaPass();
    fauna.frog.state = "sitting";
    fauna.frog.x = 40;
    fauna.frog.y = 40;
    fauna.frog.leafIndex = 0;
    fauna.frog.migrateTimer = 0.05; // Trigger migration immediately

    // Mock LotusLeavesPass with two leaves: one local, one in the opposite corner (380, 220)
    const mockLeaves = {
      getLeafCount: () => 2,
      getLeafState: (idx: number) => {
        if (idx === 0) {
          return {
            center: { x: 40, y: 40 },
            radius: 20,
            pushVel: { x: 0, y: 0 },
            displacement: 0,
            visible: true,
          };
        }
        return {
          center: { x: 380, y: 220 },
          radius: 22,
          pushVel: { x: 0, y: 0 },
          displacement: 0,
          visible: true,
        };
      },
    } as any;

    // Frame 1: timer elapses, enters migrating_dive
    fauna.update(0.1, 1.0, mockLeaves);
    expect(fauna.frog.state).toBe("migrating_dive");
    expect(fauna.frog.targetLeafIndex).toBe(1);

    // Advance through dive into water (0.35s)
    for (let t = 0; t < 0.4; t += 0.05) {
      fauna.update(0.05, 1.0 + t, mockLeaves);
    }
    expect(fauna.frog.state).toBe("migrating_swim");

    // Advance swimming across the pond until frog arrives at destination pad
    for (let t = 0; t < 15.0; t += 0.1) {
      fauna.update(0.1, 2.0 + t, mockLeaves);
      if ((fauna.frog.state as string) === "migrating_land" || (fauna.frog.state as string) === "sitting") break;
    }
    expect(["migrating_land", "sitting"]).toContain(fauna.frog.state as string);

    // Complete landing
    for (let t = 0; t < 1.0; t += 0.05) {
      fauna.update(0.05, 18.0 + t, mockLeaves);
    }
    expect(fauna.frog.state as string).toBe("sitting");
    expect(fauna.frog.leafIndex).toBe(1);
    expect(Math.hypot(fauna.frog.x - 380, fauna.frog.y - 220)).toBeLessThan(5.0);

    fauna.dispose();
  });

  it("removes dragonflies and triggers frog escape dive when weather changes to moonlight", () => {
    const fauna = new PondFaunaPass();
    // Simulate daytime to spawn a dragonfly
    for (let t = 0; t <= 4.0; t += 0.1) {
      fauna.update(0.1, t, null, null, "sunny");
      if (fauna.getDragonflies().length > 0) break;
    }
    expect(fauna.frog.state).toBe("sitting");

    // Switch to moonlight / night
    fauna.update(0.016, 4.5, null, null, "moonlight");

    // Dragonflies must be strictly 0 at night
    expect(fauna.getDragonflies().length).toBe(0);

    // Frog must trigger scare dive to escape the pond
    expect(fauna.frog.state).toBe("scared_dive");

    // Step through dive and swimming until offscreen despawn
    for (let t = 0; t < 6.0; t += 0.05) {
      fauna.update(0.05, 4.5 + t, null, null, "moonlight");
      if ((fauna.frog.state as string) === "despawned") break;
    }
    expect(fauna.frog.state).toBe("despawned");

    // Frog remains despawned while moonlight is active
    for (let t = 0; t < 10.0; t += 0.5) {
      fauna.update(0.5, 11.0 + t, null, null, "moonlight");
      expect(fauna.frog.state).toBe("despawned");
    }

    fauna.dispose();
  });

  it("activates exactly 8 fireflies drifting during moonlight and deactivates during daytime", () => {
    const fauna = new PondFaunaPass();
    const fireflies = fauna.getFireflies();
    expect(fireflies.length).toBe(8);

    // Daytime: fireflies mesh is not visible
    fauna.update(0.016, 1.0, null, null, "sunny");
    const ffMesh = (fauna.group.children as any[]).find((c) => c.renderOrder === 24);
    expect(ffMesh).toBeDefined();
    expect(ffMesh.visible).toBe(false);

    // Nighttime (moonlight): fireflies mesh is active and visible
    fauna.update(0.016, 2.0, null, null, "moonlight");
    expect(ffMesh.visible).toBe(true);

    // Check firefly positions and attributes
    for (const ff of fireflies) {
      expect(ff.x).toBeGreaterThan(0);
      expect(ff.y).toBeGreaterThan(0);
      expect(ff.haloRadius).toBeGreaterThan(2.0);
      expect(ff.coreRadius).toBeGreaterThan(0.5);
    }

    // Switch back to sunny: mesh hides again
    fauna.update(0.016, 3.0, null, null, "sunny");
    expect(ffMesh.visible).toBe(false);

    fauna.dispose();
  });
});
