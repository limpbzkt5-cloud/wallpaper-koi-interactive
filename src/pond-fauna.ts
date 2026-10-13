import * as THREE from "three";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./config";
import { clamp, normalize, type Vec2, vec } from "./math";
import type { LotusLeavesPass } from "./lotus-leaves";
import type { RippleSystem } from "./ripple-system";
import type { WeatherPresetId } from "./weather";

export type FrogState =
  | "sitting"
  | "jumping"
  | "tongue_strike"
  | "scared_dive"
  | "swimming"
  | "migrating_dive"
  | "migrating_swim"
  | "migrating_land"
  | "despawned";

export interface Dragonfly {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  hoverTimer: number;
  colorIdx: 0 | 1 | 2 | 3;
  heading: number;
  wingPhase: number;
  age: number;
  maxAge: number;
  caught: boolean;
}

const FROG_SPRITE_SIZE = 24;
const DRAGONFLY_MAX = 2;
const DRAGONFLY_COLORS = [
  { name: "emerald", body: "#10b981", dark: "#047857", wing: "rgba(167, 243, 208, 0.75)" },
  { name: "azure", body: "#06b6d4", dark: "#0284c7", wing: "rgba(186, 230, 253, 0.75)" },
  { name: "ruby", body: "#ef4444", dark: "#b91c1c", wing: "rgba(254, 202, 202, 0.75)" },
  { name: "amber", body: "#f59e0b", dark: "#d97706", wing: "rgba(253, 230, 138, 0.75)" },
] as const;

function createOffscreenCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      return { canvas, ctx };
    }
  }
  const mockCtx = {
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    imageSmoothingEnabled: false,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  const mockCanvas = {
    width,
    height,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;
  return { canvas: mockCanvas, ctx: mockCtx };
}

export class PondFaunaPass {
  public readonly group = new THREE.Group();
  public readonly shadowGroup = new THREE.Group();

  // Frog rendering
  private readonly frogCanvas: HTMLCanvasElement;
  private readonly frogCtx: CanvasRenderingContext2D;
  private readonly frogTexture: THREE.CanvasTexture;
  private readonly frogMesh: THREE.Mesh;
  private readonly frogShadowMesh: THREE.Mesh;

  // Dragonflies dynamic vertex buffers (6 vertices per quad, 2 quads per dragonfly: body + wings)
  // Max 4 dragonflies = 8 quads = 48 vertices each for body/wings and shadow
  private static readonly MAX_DF_VERTS = DRAGONFLY_MAX * 12;
  private readonly dfPositions = new Float32Array(PondFaunaPass.MAX_DF_VERTS * 3);
  private readonly dfColors = new Float32Array(PondFaunaPass.MAX_DF_VERTS * 4);
  private readonly dfGeometry = new THREE.BufferGeometry();
  private readonly dfPosAttr: THREE.BufferAttribute;
  private readonly dfColAttr: THREE.BufferAttribute;
  private readonly dfMesh: THREE.Mesh;

  private readonly dfShadowPositions = new Float32Array(PondFaunaPass.MAX_DF_VERTS * 3);
  private readonly dfShadowColors = new Float32Array(PondFaunaPass.MAX_DF_VERTS * 4);
  private readonly dfShadowGeometry = new THREE.BufferGeometry();
  private readonly dfShadowPosAttr: THREE.BufferAttribute;
  private readonly dfShadowColAttr: THREE.BufferAttribute;
  private readonly dfShadowMesh: THREE.Mesh;

  // Tongue rendering mesh (line segment from frog mouth to target)
  private readonly tonguePositions = new Float32Array(6 * 3);
  private readonly tongueColors = new Float32Array(6 * 4);
  private readonly tongueGeometry = new THREE.BufferGeometry();
  private readonly tonguePosAttr: THREE.BufferAttribute;
  private readonly tongueColAttr: THREE.BufferAttribute;
  private readonly tongueMesh: THREE.Mesh;

  // Frog State
  public frog = {
    x: CANVAS_WIDTH * 0.25,
    y: CANVAS_HEIGHT * 0.25,
    z: 0,
    leafIndex: 0,
    state: "sitting" as FrogState,
    stateTimer: 0,
    jumpStart: vec(0, 0),
    jumpTarget: vec(0, 0),
    jumpProgress: 0,
    facingAngle: 0,
    swimDir: vec(1, 0),
    idleJumpTimer: 22.0 + Math.random() * 16.0,
    migrateTimer: 28.0 + Math.random() * 8.0,
    targetLeafIndex: -1,
    respawnTimer: 0,
    tongueTimer: 0,
    tongueTarget: null as Vec2 | null,
    targetDragonfly: null as Dragonfly | null,
    gulpTimer: 0,
    swimStrokeTimer: 0,
  };

  // Dragonflies list
  private readonly dragonflies: Dragonfly[] = [];
  private nextDragonflyId = 1;
  private dragonflySpawnTimer = 3.5;

  public constructor() {
    // 1. Setup Frog Pixel Art Offscreen Canvas & Mesh
    const frogCanvasObj = createOffscreenCanvas(FROG_SPRITE_SIZE, FROG_SPRITE_SIZE);
    this.frogCanvas = frogCanvasObj.canvas;
    this.frogCtx = frogCanvasObj.ctx;

    this.frogTexture = new THREE.CanvasTexture(this.frogCanvas);
    this.frogTexture.magFilter = THREE.NearestFilter;
    this.frogTexture.minFilter = THREE.NearestFilter;
    this.frogTexture.generateMipmaps = false;

    const frogPlane = new THREE.PlaneGeometry(16, 16);
    const frogMaterial = new THREE.MeshBasicMaterial({
      map: this.frogTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.frogMesh = new THREE.Mesh(frogPlane, frogMaterial);
    this.frogMesh.renderOrder = 18; // Sits above lily pads (15), below boat (20)
    this.group.add(this.frogMesh);

    const frogShadowMaterial = new THREE.MeshBasicMaterial({
      map: this.frogTexture,
      color: 0x06141a,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.frogShadowMesh = new THREE.Mesh(frogPlane, frogShadowMaterial);
    this.frogShadowMesh.renderOrder = 6;
    this.shadowGroup.add(this.frogShadowMesh);

    // 2. Setup Dragonfly Dynamic Buffer Meshes
    this.dfPosAttr = new THREE.BufferAttribute(this.dfPositions, 3);
    this.dfColAttr = new THREE.BufferAttribute(this.dfColors, 4);
    this.dfPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.dfColAttr.setUsage(THREE.DynamicDrawUsage);
    this.dfGeometry.setAttribute("position", this.dfPosAttr);
    this.dfGeometry.setAttribute("color", this.dfColAttr);

    const dfMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.dfMesh = new THREE.Mesh(this.dfGeometry, dfMaterial);
    this.dfMesh.renderOrder = 22; // Flies high above water surface
    this.group.add(this.dfMesh);

    this.dfShadowPosAttr = new THREE.BufferAttribute(this.dfShadowPositions, 3);
    this.dfShadowColAttr = new THREE.BufferAttribute(this.dfShadowColors, 4);
    this.dfShadowPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.dfShadowColAttr.setUsage(THREE.DynamicDrawUsage);
    this.dfShadowGeometry.setAttribute("position", this.dfShadowPosAttr);
    this.dfShadowGeometry.setAttribute("color", this.dfShadowColAttr);

    const dfShadowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.dfShadowMesh = new THREE.Mesh(this.dfShadowGeometry, dfShadowMaterial);
    this.dfShadowMesh.renderOrder = 5;
    this.shadowGroup.add(this.dfShadowMesh);

    // 3. Setup Tongue Strike Mesh
    this.tonguePosAttr = new THREE.BufferAttribute(this.tonguePositions, 3);
    this.tongueColAttr = new THREE.BufferAttribute(this.tongueColors, 4);
    this.tonguePosAttr.setUsage(THREE.DynamicDrawUsage);
    this.tongueColAttr.setUsage(THREE.DynamicDrawUsage);
    this.tongueGeometry.setAttribute("position", this.tonguePosAttr);
    this.tongueGeometry.setAttribute("color", this.tongueColAttr);

    const tongueMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.tongueMesh = new THREE.Mesh(this.tongueGeometry, tongueMaterial);
    this.tongueMesh.renderOrder = 21;
    this.group.add(this.tongueMesh);

    // Initial frog drawing
    this.redrawFrog();
  }

  /**
   * Main per-frame simulation update.
   */
  public update(
    dt: number,
    time: number,
    lotusLeaves?: LotusLeavesPass | null,
    ripples?: RippleSystem | null,
    _weatherId: WeatherPresetId = "sunny",
  ): void {
    // 1. Update Frog Lifecycle & State Machine
    this.updateFrog(dt, time, lotusLeaves, ripples);

    // 2. Update Dragonflies
    this.updateDragonflies(dt, time);

    // 3. Commit Dragonfly Geometry
    this.commitDragonflyGeometry(time);

    // 4. Commit Tongue Mesh
    this.commitTongueGeometry();

    // 5. Update Frog Mesh Transforms
    this.updateFrogTransforms(time);
  }

  /**
   * Trigger frog scare dive if water was clicked/disturbed near its current position.
   */
  public notifyWaterDisturbed(pos: Vec2, radius = 35): void {
    if (this.frog.state === "despawned" || this.frog.state === "swimming" || this.frog.state === "scared_dive") {
      return;
    }
    const d = Math.hypot(this.frog.x - pos.x, this.frog.y - pos.y);
    if (d <= radius + 15) {
      this.triggerScareDive();
    }
  }

  private updateFrog(
    dt: number,
    _time: number,
    lotusLeaves?: LotusLeavesPass | null,
    ripples?: RippleSystem | null,
  ): void {
    const f = this.frog;

    // Check respawn if despawned
    if (f.state === "despawned") {
      f.respawnTimer -= dt;
      if (f.respawnTimer <= 0 && lotusLeaves && lotusLeaves.getLeafCount() > 0) {
        // Spawn on a random available lily pad
        const count = lotusLeaves.getLeafCount();
        const randIdx = Math.floor(Math.random() * count);
        const leaf = lotusLeaves.getLeafState(randIdx);
        if (leaf) {
          f.leafIndex = randIdx;
          f.x = leaf.center.x;
          f.y = leaf.center.y;
          f.z = 0;
          f.state = "sitting";
          f.stateTimer = 0;
          f.idleJumpTimer = 22.0 + Math.random() * 16.0;
          f.migrateTimer = 28.0 + Math.random() * 8.0;
          f.targetLeafIndex = -1;
          f.facingAngle = Math.random() * Math.PI * 2;
          this.redrawFrog();
        }
      }
      return;
    }

    // Sitting on Lily Pad
    if (f.state === "sitting") {
      // Synchronize position with dynamic animated lily pad
      if (lotusLeaves) {
        const leaf = lotusLeaves.getLeafState(f.leafIndex);
        if (leaf) {
          f.x = leaf.center.x;
          f.y = leaf.center.y;
          f.z = 0;

          // Check if lily pad was disturbed by ripples or displacement
          const velMag = Math.hypot(leaf.pushVel.x, leaf.pushVel.y);
          if (velMag > 2.0 || leaf.displacement > 2.4) {
            this.triggerScareDive(ripples);
            return;
          }
        }
      }

      // Check for dragonflies nearby to catch with tongue
      if (f.gulpTimer <= 0) {
        const catchDist = 32.0;
        let closestDf: Dragonfly | null = null;
        let minD = catchDist;

        for (const df of this.dragonflies) {
          if (df.caught) continue;
          const d = Math.hypot(df.x - f.x, df.y - f.y);
          if (d < minD) {
            minD = d;
            closestDf = df;
          }
        }

        if (closestDf) {
          f.state = "tongue_strike";
          f.targetDragonfly = closestDf;
          closestDf.caught = true;
          f.tongueTarget = vec(closestDf.x, closestDf.y);
          f.tongueTimer = 0;
          f.facingAngle = Math.atan2(closestDf.y - f.y, closestDf.x - f.x);
          this.redrawFrog();
          return;
        }
      }

      if (f.gulpTimer > 0) {
        f.gulpTimer -= dt;
      }

      // 1. Cross-Bundle Relocation (every ~30s, migrate to a lily pad bundle in another corner)
      f.migrateTimer -= dt;
      if (f.migrateTimer <= 0 && lotusLeaves && lotusLeaves.getLeafCount() > 1) {
        f.migrateTimer = 28.0 + Math.random() * 8.0;
        f.idleJumpTimer = 22.0 + Math.random() * 16.0;

        const count = lotusLeaves.getLeafCount();
        const distantLeaves: { idx: number; dist: number }[] = [];
        for (let i = 0; i < count; i++) {
          if (i === f.leafIndex) continue;
          const leaf = lotusLeaves.getLeafState(i);
          if (!leaf) continue;
          const d = Math.hypot(leaf.center.x - f.x, leaf.center.y - f.y);
          if (d >= 130.0) {
            distantLeaves.push({ idx: i, dist: d });
          }
        }

        let chosenIdx = -1;
        if (distantLeaves.length > 0) {
          const randChoice = distantLeaves[Math.floor(Math.random() * distantLeaves.length)];
          chosenIdx = randChoice.idx;
        } else {
          let maxD = 0;
          for (let i = 0; i < count; i++) {
            if (i === f.leafIndex) continue;
            const leaf = lotusLeaves.getLeafState(i);
            if (!leaf) continue;
            const d = Math.hypot(leaf.center.x - f.x, leaf.center.y - f.y);
            if (d > maxD) {
              maxD = d;
              chosenIdx = i;
            }
          }
        }

        if (chosenIdx >= 0) {
          const targetLeaf = lotusLeaves.getLeafState(chosenIdx)!;
          f.targetLeafIndex = chosenIdx;
          const toTarget = normalize(
            vec(targetLeaf.center.x - f.x, targetLeaf.center.y - f.y),
            vec(1, 0),
          );
          f.swimDir = toTarget;
          f.facingAngle = Math.atan2(toTarget.y, toTarget.x);
          f.jumpStart = vec(f.x, f.y);
          f.jumpTarget = vec(f.x + toTarget.x * 16.0, f.y + toTarget.y * 16.0);
          f.state = "migrating_dive";
          f.stateTimer = 0;
          this.redrawFrog();
          return;
        }
      }

      // 2. Idle Jump between adjacent lily pads within the same bundle (much lower frequency)
      f.idleJumpTimer -= dt;
      if (f.idleJumpTimer <= 0 && lotusLeaves && lotusLeaves.getLeafCount() > 1) {
        f.idleJumpTimer = 22.0 + Math.random() * 16.0;
        const count = lotusLeaves.getLeafCount();
        // Pick an adjacent visible lily pad in the same bundle (distance 15 to 85)
        let bestTargetIdx = -1;
        let bestDist = 85.0;
        for (let i = 0; i < count; i++) {
          if (i === f.leafIndex) continue;
          const targetLeaf = lotusLeaves.getLeafState(i);
          if (targetLeaf) {
            const d = Math.hypot(targetLeaf.center.x - f.x, targetLeaf.center.y - f.y);
            if (d < bestDist && d > 15.0) {
              bestDist = d;
              bestTargetIdx = i;
            }
          }
        }

        if (bestTargetIdx >= 0) {
          const targetLeaf = lotusLeaves.getLeafState(bestTargetIdx)!;
          f.state = "jumping";
          f.stateTimer = 0;
          f.jumpProgress = 0;
          f.jumpStart = vec(f.x, f.y);
          f.jumpTarget = vec(targetLeaf.center.x, targetLeaf.center.y);
          f.leafIndex = bestTargetIdx;
          f.facingAngle = Math.atan2(f.jumpTarget.y - f.jumpStart.y, f.jumpTarget.x - f.jumpStart.x);
          this.redrawFrog();
        }
      }
    } else if (f.state === "jumping") {
      // Parabolic jump arc between lily pads
      f.stateTimer += dt;
      const jumpDuration = 0.48;
      f.jumpProgress = clamp(f.stateTimer / jumpDuration, 0, 1);

      f.x = f.jumpStart.x + (f.jumpTarget.x - f.jumpStart.x) * f.jumpProgress;
      f.y = f.jumpStart.y + (f.jumpTarget.y - f.jumpStart.y) * f.jumpProgress;
      // Parabolic altitude z: 4 * h * p * (1 - p)
      f.z = 4 * 14.0 * f.jumpProgress * (1 - f.jumpProgress);

      if (f.jumpProgress >= 1.0) {
        f.z = 0;
        f.state = "sitting";
        f.stateTimer = 0;
        this.redrawFrog();
        if (ripples) {
          ripples.trigger("mouth", vec(f.x, f.y));
        }
      }
    } else if (f.state === "tongue_strike") {
      // Fast strike: out in 0.08s, back with prey in 0.10s
      f.tongueTimer += dt;
      const totalStrikeTime = 0.20;

      if (f.targetDragonfly) {
        if (f.tongueTimer < 0.09) {
          // Shooting out towards dragonfly
          const p = f.tongueTimer / 0.09;
          f.tongueTarget = vec(
            f.x + (f.targetDragonfly.x - f.x) * p,
            f.y + (f.targetDragonfly.y - f.y) * p,
          );
        } else {
          // Pulling dragonfly back into frog mouth
          const p = 1.0 - (f.tongueTimer - 0.09) / 0.11;
          f.targetDragonfly.x = f.x + (f.targetDragonfly.x - f.x) * Math.max(0, p);
          f.targetDragonfly.y = f.y + (f.targetDragonfly.y - f.y) * Math.max(0, p);
          f.tongueTarget = vec(f.targetDragonfly.x, f.targetDragonfly.y);
        }
      }

      if (f.tongueTimer >= totalStrikeTime) {
        // Dragonfly consumed!
        if (f.targetDragonfly) {
          const idx = this.dragonflies.indexOf(f.targetDragonfly);
          if (idx >= 0) this.dragonflies.splice(idx, 1);
          f.targetDragonfly = null;
        }
        f.tongueTarget = null;
        f.state = "sitting";
        f.gulpTimer = 0.35; // Gulp / swallow animation
        this.redrawFrog();
        if (ripples) {
          ripples.trigger("mouth", vec(f.x, f.y));
        }
      }
    } else if (f.state === "scared_dive") {
      // Leap off the lily pad into the open water
      f.stateTimer += dt;
      const diveDuration = 0.32;
      const p = clamp(f.stateTimer / diveDuration, 0, 1);

      f.x = f.jumpStart.x + (f.jumpTarget.x - f.jumpStart.x) * p;
      f.y = f.jumpStart.y + (f.jumpTarget.y - f.jumpStart.y) * p;
      f.z = 4 * 10.0 * p * (1 - p);

      if (p >= 1.0) {
        f.z = 0;
        f.state = "swimming";
        f.stateTimer = 0;
        this.redrawFrog();
        if (ripples) {
          ripples.trigger("touch", vec(f.x, f.y));
        }
      }
    } else if (f.state === "swimming") {
      // Rapid breaststroke swimming away from pond towards nearest edge
      f.stateTimer += dt;
      f.swimStrokeTimer += dt;

      // Pulse swimming velocity with frog leg strokes
      const strokeFreq = 3.2; // 3.2 strokes per sec
      const strokePhase = (f.swimStrokeTimer * strokeFreq) % 1.0;
      const strokePower = Math.pow(Math.sin(strokePhase * Math.PI), 2.0);
      const swimSpeed = 22.0 + strokePower * 36.0;

      f.x += f.swimDir.x * swimSpeed * dt;
      f.y += f.swimDir.y * swimSpeed * dt;

      // Stroke water ripples
      if (strokePhase < 0.15 && strokePower > 0.8 && ripples) {
        ripples.trigger("mouth", vec(f.x, f.y));
      }

      // Check screen boundary despawn
      const pad = 24.0;
      if (f.x < -pad || f.x > CANVAS_WIDTH + pad || f.y < -pad || f.y > CANVAS_HEIGHT + pad) {
        f.state = "despawned";
        f.respawnTimer = 28.0 + Math.random() * 22.0; // Respawns after 28-50s
        this.redrawFrog();
      }
    } else if (f.state === "migrating_dive") {
      // Leap gently off the lily pad into the open water towards the distant bundle
      f.stateTimer += dt;
      const diveDuration = 0.35;
      const p = clamp(f.stateTimer / diveDuration, 0, 1);

      f.x = f.jumpStart.x + (f.jumpTarget.x - f.jumpStart.x) * p;
      f.y = f.jumpStart.y + (f.jumpTarget.y - f.jumpStart.y) * p;
      f.z = 4 * 8.0 * p * (1 - p);

      if (p >= 1.0) {
        f.z = 0;
        f.state = "migrating_swim";
        f.stateTimer = 0;
        f.swimStrokeTimer = 0;
        this.redrawFrog();
        if (ripples) {
          ripples.trigger("mouth", vec(f.x, f.y));
        }
      }
    } else if (f.state === "migrating_swim") {
      // Calm, purposeful swim across the pond towards destination lily pad
      f.stateTimer += dt;
      f.swimStrokeTimer += dt;

      let targetPos = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
      let targetRadius = 20.0;
      if (lotusLeaves && f.targetLeafIndex >= 0) {
        const destLeaf = lotusLeaves.getLeafState(f.targetLeafIndex);
        if (destLeaf) {
          targetPos = vec(destLeaf.center.x, destLeaf.center.y);
          targetRadius = destLeaf.radius;
        }
      }

      const dx = targetPos.x - f.x;
      const dy = targetPos.y - f.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 1.0) {
        f.swimDir = vec(dx / dist, dy / dist);
        f.facingAngle = Math.atan2(f.swimDir.y, f.swimDir.x);
      }

      // Breaststroke propulsion rhythm (smooth leisurely swim)
      const strokeFreq = 2.4; // 2.4 strokes per sec
      const strokePhase = (f.swimStrokeTimer * strokeFreq) % 1.0;
      const strokePower = Math.pow(Math.sin(strokePhase * Math.PI), 2.0);
      const swimSpeed = 24.0 + strokePower * 30.0;

      f.x += f.swimDir.x * swimSpeed * dt;
      f.y += f.swimDir.y * swimSpeed * dt;

      // Gentle swimming stroke ripples
      if (strokePhase < 0.15 && strokePower > 0.8 && ripples) {
        ripples.trigger("mouth", vec(f.x, f.y));
      }

      // Check arrival at destination lily pad edge
      if (dist <= targetRadius * 0.75 + 8.0 || f.stateTimer > 20.0) {
        f.state = "migrating_land";
        f.stateTimer = 0;
        f.jumpStart = vec(f.x, f.y);
        f.jumpTarget = targetPos;
        this.redrawFrog();
      }
    } else if (f.state === "migrating_land") {
      // Hop gracefully out of the water onto the destination lily pad
      f.stateTimer += dt;
      const landDuration = 0.40;
      const p = clamp(f.stateTimer / landDuration, 0, 1);

      f.x = f.jumpStart.x + (f.jumpTarget.x - f.jumpStart.x) * p;
      f.y = f.jumpStart.y + (f.jumpTarget.y - f.jumpStart.y) * p;
      f.z = 4 * 12.0 * p * (1 - p);

      if (p >= 1.0) {
        f.z = 0;
        f.leafIndex = f.targetLeafIndex >= 0 ? f.targetLeafIndex : f.leafIndex;
        f.state = "sitting";
        f.stateTimer = 0;
        f.idleJumpTimer = 22.0 + Math.random() * 16.0;
        f.migrateTimer = 28.0 + Math.random() * 8.0;
        f.targetLeafIndex = -1;
        this.redrawFrog();
        if (ripples) {
          ripples.trigger("mouth", vec(f.x, f.y));
        }
      }
    }
  }

  /**
   * Initiate the scared dive off the lily pad.
   */
  public triggerScareDive(ripples?: RippleSystem | null): void {
    if (this.frog.state === "despawned" || this.frog.state === "swimming" || this.frog.state === "scared_dive") {
      return;
    }
    const f = this.frog;
    f.targetLeafIndex = -1;

    // Calculate escape vector pointing towards nearest screen edge
    const distLeft = f.x;
    const distRight = CANVAS_WIDTH - f.x;
    const distTop = f.y;
    const distBottom = CANVAS_HEIGHT - f.y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);

    let escapeDir = vec(0, 0);
    if (minDist === distLeft) escapeDir = vec(-1, (Math.random() - 0.5) * 0.4);
    else if (minDist === distRight) escapeDir = vec(1, (Math.random() - 0.5) * 0.4);
    else if (minDist === distTop) escapeDir = vec((Math.random() - 0.5) * 0.4, -1);
    else escapeDir = vec((Math.random() - 0.5) * 0.4, 1);
    escapeDir = normalize(escapeDir, vec(1, 0));

    f.swimDir = escapeDir;
    f.jumpStart = vec(f.x, f.y);
    f.jumpTarget = vec(f.x + escapeDir.x * 24.0, f.y + escapeDir.y * 24.0);
    f.state = "scared_dive";
    f.stateTimer = 0;
    f.facingAngle = Math.atan2(escapeDir.y, escapeDir.x);
    this.redrawFrog();

    if (ripples) {
      ripples.trigger("mouth", vec(f.x, f.y));
    }
  }

  private updateDragonflies(dt: number, time: number): void {
    // 1. Spawn new dragonfly if capacity allows
    this.dragonflySpawnTimer -= dt;
    if (this.dragonflySpawnTimer <= 0 && this.dragonflies.length < DRAGONFLY_MAX) {
      this.dragonflySpawnTimer = 18.0 + Math.random() * 16.0;
      this.spawnDragonfly();
    }

    // 2. Simulate dragonflies
    for (let i = this.dragonflies.length - 1; i >= 0; i--) {
      const df = this.dragonflies[i];
      df.age += dt;

      // Skip movement if currently caught by frog tongue
      if (df.caught) continue;

      df.wingPhase = (df.wingPhase + dt * 42.0) % (Math.PI * 2);

      if (df.hoverTimer > 0) {
        df.hoverTimer -= dt;
        // Subtle ambient hovering flutter
        df.x += Math.sin(time * 3.5 + df.id) * 0.18;
        df.y += Math.cos(time * 3.1 + df.id) * 0.18;
      } else {
        // Darting flight towards target waypoint
        const dx = df.targetX - df.x;
        const dy = df.targetY - df.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= 6.0 || df.age > df.maxAge) {
          // Arrived at waypoint: decide next waypoint or exit pond
          if (df.age > df.maxAge) {
            // Exit out of screen
            df.targetX = df.x > CANVAS_WIDTH * 0.5 ? CANVAS_WIDTH + 40 : -40;
            df.targetY = df.y + (Math.random() - 0.5) * 80;
            df.hoverTimer = 0;
          } else {
            // Hover in place for a brief moment then dart to new spot
            df.hoverTimer = 0.8 + Math.random() * 2.2;
            df.targetX = 40 + Math.random() * (CANVAS_WIDTH - 80);
            df.targetY = 30 + Math.random() * (CANVAS_HEIGHT - 60);
          }
        } else {
          const speed = 48.0 + Math.sin(df.id + time) * 12.0;
          const targetHeading = Math.atan2(dy, dx);
          // Smooth angular turn
          let angleDiff = targetHeading - df.heading;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          df.heading += angleDiff * Math.min(1.0, dt * 8.0);

          df.vx = Math.cos(df.heading) * speed;
          df.vy = Math.sin(df.heading) * speed;
          df.x += df.vx * dt;
          df.y += df.vy * dt;
        }
      }

      // Check despawn if flown far outside screen
      if (df.age > df.maxAge && (df.x < -50 || df.x > CANVAS_WIDTH + 50 || df.y < -50 || df.y > CANVAS_HEIGHT + 50)) {
        this.dragonflies.splice(i, 1);
      }
    }
  }

  private spawnDragonfly(): void {
    const side = Math.floor(Math.random() * 4);
    let startX = 0;
    let startY = 0;
    if (side === 0) { startX = -20; startY = Math.random() * CANVAS_HEIGHT; }
    else if (side === 1) { startX = CANVAS_WIDTH + 20; startY = Math.random() * CANVAS_HEIGHT; }
    else if (side === 2) { startX = Math.random() * CANVAS_WIDTH; startY = -20; }
    else { startX = Math.random() * CANVAS_WIDTH; startY = CANVAS_HEIGHT + 20; }

    const targetX = 60 + Math.random() * (CANVAS_WIDTH - 120);
    const targetY = 40 + Math.random() * (CANVAS_HEIGHT - 80);
    const colorIdx = (Math.floor(Math.random() * 4)) as 0 | 1 | 2 | 3;

    this.dragonflies.push({
      id: this.nextDragonflyId++,
      x: startX,
      y: startY,
      z: 7.0 + Math.random() * 4.0,
      vx: 0,
      vy: 0,
      targetX,
      targetY,
      hoverTimer: 0,
      colorIdx,
      heading: Math.atan2(targetY - startY, targetX - startX),
      wingPhase: Math.random() * Math.PI * 2,
      age: 0,
      maxAge: 25.0 + Math.random() * 20.0,
      caught: false,
    });
  }

  /**
   * Commit Dragonfly quads to dynamic GPU geometry.
   */
  private commitDragonflyGeometry(_time: number): void {
    let vertCursor = 0;
    let shadowVertCursor = 0;

    const writeQuad = (
      bufPos: Float32Array,
      bufCol: Float32Array,
      cursor: number,
      p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2,
      r: number, g: number, b: number, a: number,
      z = 0.08,
    ): number => {
      const pts = [p0, p1, p2, p0, p2, p3];
      for (let i = 0; i < 6; i++) {
        const vIdx = cursor + i;
        bufPos[vIdx * 3] = pts[i].x;
        bufPos[vIdx * 3 + 1] = pts[i].y;
        bufPos[vIdx * 3 + 2] = z;

        bufCol[vIdx * 4] = r;
        bufCol[vIdx * 4 + 1] = g;
        bufCol[vIdx * 4 + 2] = b;
        bufCol[vIdx * 4 + 3] = a;
      }
      return cursor + 6;
    };

    for (const df of this.dragonflies) {
      if (vertCursor + 12 > PondFaunaPass.MAX_DF_VERTS) break;

      const pal = DRAGONFLY_COLORS[df.colorIdx];
      const col = new THREE.Color(pal.body);

      const cosH = Math.cos(df.heading);
      const sinH = Math.sin(df.heading);
      const perpX = -sinH;
      const perpY = cosH;

      // 1. Slender Abdomen & Thorax Body (length 11, half-width 1.2)
      const headX = df.x + cosH * 4.5;
      const headY = df.y + sinH * 4.5;
      const tailX = df.x - cosH * 7.5;
      const tailY = df.y - sinH * 7.5;
      const bw = 1.2;

      const b0 = vec(headX + perpX * bw, headY + perpY * bw);
      const b1 = vec(headX - perpX * bw, headY - perpY * bw);
      const b2 = vec(tailX - perpX * bw * 0.6, tailY - perpY * bw * 0.6);
      const b3 = vec(tailX + perpX * bw * 0.6, tailY + perpY * bw * 0.6);

      vertCursor = writeQuad(
        this.dfPositions, this.dfColors, vertCursor,
        b0, b1, b2, b3,
        col.r, col.g, col.b, 0.95,
        0.12,
      );

      // 2. Fluttering Dual Wings (High frequency sinusoidal flutter)
      const wingSpan = 7.5;
      const wingFlap = Math.sin(df.wingPhase) * 0.85;
      const wPitchX = cosH * wingFlap * 1.5;
      const wPitchY = sinH * wingFlap * 1.5;

      const wLeft = vec(df.x + perpX * wingSpan + wPitchX, df.y + perpY * wingSpan + wPitchY);
      const wRight = vec(df.x - perpX * wingSpan - wPitchX, df.y - perpY * wingSpan - wPitchY);
      const wCenterFwd = vec(df.x + cosH * 2.0, df.y + sinH * 2.0);
      const wCenterAft = vec(df.x - cosH * 2.0, df.y - sinH * 2.0);

      vertCursor = writeQuad(
        this.dfPositions, this.dfColors, vertCursor,
        wCenterFwd, wRight, wCenterAft, wLeft,
        0.85, 0.95, 1.0, 0.65,
        0.14,
      );

      // 3. Shadow Quad on Water Surface
      const shadowOffX = 2.4;
      const shadowOffY = 3.6;
      const sb0 = vec(b0.x + shadowOffX, b0.y + shadowOffY);
      const sb1 = vec(b1.x + shadowOffX, b1.y + shadowOffY);
      const sb2 = vec(b2.x + shadowOffX, b2.y + shadowOffY);
      const sb3 = vec(b3.x + shadowOffX, b3.y + shadowOffY);

      shadowVertCursor = writeQuad(
        this.dfShadowPositions, this.dfShadowColors, shadowVertCursor,
        sb0, sb1, sb2, sb3,
        0.02, 0.08, 0.10, 0.22,
        0.03,
      );
    }

    this.dfGeometry.setDrawRange(0, vertCursor);
    this.dfPosAttr.needsUpdate = true;
    this.dfColAttr.needsUpdate = true;

    this.dfShadowGeometry.setDrawRange(0, shadowVertCursor);
    this.dfShadowPosAttr.needsUpdate = true;
    this.dfShadowColAttr.needsUpdate = true;
  }

  /**
   * Commit Frog's Tongue Quad when striking a dragonfly.
   */
  private commitTongueGeometry(): void {
    const f = this.frog;
    if (f.state !== "tongue_strike" || !f.tongueTarget) {
      this.tongueGeometry.setDrawRange(0, 0);
      return;
    }

    const mouthX = f.x + Math.cos(f.facingAngle) * 4.0;
    const mouthY = f.y + Math.sin(f.facingAngle) * 4.0;
    const targetX = f.tongueTarget.x;
    const targetY = f.tongueTarget.y;

    const dx = targetX - mouthX;
    const dy = targetY - mouthY;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.5) {
      this.tongueGeometry.setDrawRange(0, 0);
      return;
    }

    const nx = -dy / dist;
    const ny = dx / dist;
    const tw = 0.8; // Tongue half-width

    const p0 = vec(mouthX + nx * tw, mouthY + ny * tw);
    const p1 = vec(mouthX - nx * tw, mouthY - ny * tw);
    const p2 = vec(targetX - nx * tw, targetY - ny * tw);
    const p3 = vec(targetX + nx * tw, targetY + ny * tw);

    const pts = [p0, p1, p2, p0, p2, p3];
    for (let i = 0; i < 6; i++) {
      this.tonguePositions[i * 3] = pts[i].x;
      this.tonguePositions[i * 3 + 1] = pts[i].y;
      this.tonguePositions[i * 3 + 2] = 0.16;

      // Vivid rose coral tongue color
      this.tongueColors[i * 4] = 0.98;
      this.tongueColors[i * 4 + 1] = 0.32;
      this.tongueColors[i * 4 + 2] = 0.42;
      this.tongueColors[i * 4 + 3] = 0.95;
    }

    this.tongueGeometry.setDrawRange(0, 6);
    this.tonguePosAttr.needsUpdate = true;
    this.tongueColAttr.needsUpdate = true;
  }

  /**
   * Update Three.js Object Transforms for the frog and its shadow.
   */
  private updateFrogTransforms(_time: number): void {
    const f = this.frog;
    const isVisible = f.state !== "despawned";
    this.frogMesh.visible = isVisible;
    this.frogShadowMesh.visible = isVisible;

    if (!isVisible) return;

    this.frogMesh.position.set(f.x, f.y - f.z, 0.10);
    this.frogMesh.rotation.z = f.facingAngle - Math.PI * 0.5;

    // Contact shadow with parallax lift based on height z
    const shadowLift = 1.0 + f.z * 0.08;
    this.frogShadowMesh.position.set(f.x + 1.8 * shadowLift, f.y + 2.8 * shadowLift, 0.04);
    this.frogShadowMesh.rotation.z = f.facingAngle - Math.PI * 0.5;
    this.frogShadowMesh.scale.setScalar(1.0 - Math.min(0.4, f.z * 0.02));
  }

  /**
   * Handcraft Authentic Pixel Art Frog Sprites into Offscreen Canvas.
   */
  public redrawFrog(): void {
    const ctx = this.frogCtx;
    ctx.clearRect(0, 0, FROG_SPRITE_SIZE, FROG_SPRITE_SIZE);

    if (this.frog.state === "despawned") {
      this.frogTexture.needsUpdate = true;
      return;
    }

    const px = (x: number, y: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    };
    const rect = (x: number, y: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    };

    // Frog Palette
    const C_OUTLINE = "#14532d";      // Dark moss contour
    const C_BODY_MAIN = "#22c55e";    // Vibrant grass green
    const C_BODY_LIGHT = "#4ade80";   // Lime green highlight
    const C_BODY_SPOT = "#166534";    // Back dorsal spots
    const C_BELLY = "#fef08a";        // Warm buttery cream belly
    const C_EYE_YELLOW = "#facc15";   // Golden iris
    const C_EYE_PUPIL = "#0f172a";    // Obsidian pupil
    const C_WHITE = "#ffffff";        // Specular eye gleam
    const C_MOUTH_OPEN = "#e11d48";   // Tongue cavity pink

    const state = this.frog.state;

    if (
      state === "jumping" ||
      state === "scared_dive" ||
      state === "migrating_dive" ||
      state === "migrating_land"
    ) {
      // JUMPING POSE: Elongated aerodynamic torso with extended back legs
      // 1. Back extended kicking legs
      rect(5, 17, 3, 5, C_BODY_MAIN);
      rect(16, 17, 3, 5, C_BODY_MAIN);
      px(4, 22, C_BODY_LIGHT); px(5, 22, C_BODY_LIGHT);
      px(17, 22, C_BODY_LIGHT); px(18, 22, C_BODY_LIGHT);

      // 2. Streamlined Torso
      rect(8, 7, 8, 10, C_BODY_MAIN);
      rect(9, 8, 6, 8, C_BODY_LIGHT);
      rect(10, 10, 4, 5, C_BELLY);

      // Dorsal spots
      px(10, 8, C_BODY_SPOT);
      px(13, 9, C_BODY_SPOT);

      // 3. Front Arms Reaching Forward
      rect(6, 6, 2, 4, C_BODY_MAIN);
      rect(16, 6, 2, 4, C_BODY_MAIN);
      px(5, 5, C_BODY_LIGHT);
      px(18, 5, C_BODY_LIGHT);

      // 4. Head & Eyes
      rect(9, 4, 6, 4, C_BODY_MAIN);
      // Left eye
      rect(7, 3, 3, 3, C_OUTLINE);
      px(8, 3, C_EYE_YELLOW);
      px(8, 4, C_EYE_PUPIL);
      px(7, 3, C_WHITE);
      // Right eye
      rect(14, 3, 3, 3, C_OUTLINE);
      px(15, 3, C_EYE_YELLOW);
      px(15, 4, C_EYE_PUPIL);
      px(14, 3, C_WHITE);
    } else if (state === "swimming" || state === "migrating_swim") {
      // SWIMMING POSE: Water surface breaststroke posture
      // 1. Kicking splayed webbed legs
      rect(4, 15, 4, 3, C_BODY_MAIN);
      rect(16, 15, 4, 3, C_BODY_MAIN);
      px(3, 17, C_BODY_LIGHT); px(4, 18, C_BODY_LIGHT);
      px(19, 17, C_BODY_LIGHT); px(20, 18, C_BODY_LIGHT);

      // 2. Flattened Oval Body
      rect(7, 8, 10, 7, C_BODY_MAIN);
      rect(8, 9, 8, 5, C_BODY_LIGHT);
      rect(9, 10, 6, 3, C_BELLY);

      // 3. Front paddling hands
      rect(6, 7, 2, 3, C_BODY_MAIN);
      rect(16, 7, 2, 3, C_BODY_MAIN);

      // 4. Head raised above water
      rect(8, 5, 8, 4, C_BODY_MAIN);
      // Left eye
      rect(7, 4, 3, 3, C_OUTLINE);
      px(8, 4, C_EYE_YELLOW);
      px(8, 5, C_EYE_PUPIL);
      // Right eye
      rect(14, 4, 3, 3, C_OUTLINE);
      px(15, 4, C_EYE_YELLOW);
      px(15, 5, C_EYE_PUPIL);
    } else {
      // SITTING / IDLE POSE: Compact plump frog resting on lily pad
      // 1. Folded Back Thighs & Webbed Feet
      rect(4, 13, 4, 5, C_BODY_MAIN); // Left thigh
      rect(16, 13, 4, 5, C_BODY_MAIN); // Right thigh
      px(4, 17, C_BODY_LIGHT); px(5, 17, C_BODY_LIGHT);
      px(18, 17, C_BODY_LIGHT); px(19, 17, C_BODY_LIGHT);

      // 2. Main Plump Torso
      rect(7, 8, 10, 9, C_BODY_MAIN);
      rect(8, 9, 8, 7, C_BODY_LIGHT);
      rect(9, 11, 6, 5, C_BELLY);

      // Cute Dorsal Spots
      px(9, 9, C_BODY_SPOT);
      px(14, 9, C_BODY_SPOT);
      px(11, 10, C_BODY_SPOT);

      // 3. Front Arms Resting on Pad
      rect(7, 13, 2, 4, C_BODY_MAIN);
      rect(15, 13, 2, 4, C_BODY_MAIN);
      px(6, 16, C_BODY_LIGHT);
      px(17, 16, C_BODY_LIGHT);

      // 4. Head & Snout
      rect(8, 5, 8, 4, C_BODY_MAIN);

      if (state === "tongue_strike") {
        // Open mouth for tongue strike
        rect(10, 4, 4, 2, C_MOUTH_OPEN);
      }

      // 5. Large Expressive Golden Eyes
      // Left Eye
      rect(6, 3, 4, 4, C_OUTLINE);
      rect(7, 4, 2, 2, C_EYE_YELLOW);
      px(8, 4, C_EYE_PUPIL);
      px(7, 4, C_WHITE);

      // Right Eye
      rect(14, 3, 4, 4, C_OUTLINE);
      rect(15, 4, 2, 2, C_EYE_YELLOW);
      px(15, 4, C_EYE_PUPIL);
      px(16, 4, C_WHITE);
    }

    this.frogTexture.needsUpdate = true;
  }

  public getDragonflies(): readonly Dragonfly[] {
    return this.dragonflies;
  }

  public dispose(): void {
    this.frogMesh.geometry.dispose();
    (this.frogMesh.material as THREE.Material).dispose();
    this.frogShadowMesh.geometry.dispose();
    (this.frogShadowMesh.material as THREE.Material).dispose();
    this.frogTexture.dispose();

    this.dfGeometry.dispose();
    (this.dfMesh.material as THREE.Material).dispose();
    this.dfShadowGeometry.dispose();
    (this.dfShadowMesh.material as THREE.Material).dispose();

    this.tongueGeometry.dispose();
    (this.tongueMesh.material as THREE.Material).dispose();
  }
}
