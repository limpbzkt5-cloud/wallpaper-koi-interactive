import * as THREE from "three";
import { clamp, length, normalize, type Vec2, vec } from "./math";
import type { WeatherPresetId } from "./weather";

export interface WakeNode {
  pos: Vec2;
  forward: Vec2;
  normal: Vec2;
  age: number;
  maxAge: number;
  scale: number;
  speed: number;
}

export interface FoamParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  maxAge: number;
  /** Spray phase 1–4: controls fan angle, size, alpha, and lifetime */
  phase: 1 | 2 | 3 | 4;
}

const MAX_WAKE_NODES = 64;
const MAX_FOAM_PARTICLES = 240;

// Capacity calculation:
// Each segment between 2 nodes creates:
// - 2 quads for twin propeller core tracks (port & starboard) = 12 vertices
// - 1 quad for central foam V-wedge = 6 vertices
// - 2 quads for Kelvin wake outer crests = 12 vertices
// Total per segment = 30 vertices.
// Max ribbon segments = (MAX_WAKE_NODES - 1) * 30 = 63 * 30 = 1890 vertices.
// Foam particles = MAX_FOAM_PARTICLES * 6 = 1440 vertices.
// Total vertices = 1890 + 1440 = 3330 vertices.
const MAX_VERTICES = (MAX_WAKE_NODES - 1) * 30 + MAX_FOAM_PARTICLES * 6;

const WAKE_WEATHER_TINTS: Record<WeatherPresetId, { r: number; g: number; b: number }> = {
  sunny: { r: 1.0, g: 1.0, b: 1.0 },
  "deep-clear": { r: 0.95, g: 1.0, b: 1.0 },
  overcast: { r: 0.88, g: 0.92, b: 0.95 },
  mist: { r: 0.85, g: 0.94, b: 0.96 },
  sunset: { r: 1.05, g: 0.90, b: 0.82 },
  moonlight: { r: 0.75, g: 0.85, b: 1.0 },
  rain: { r: 0.82, g: 0.88, b: 0.92 },
};

export class BoatWakeTrail {
  public readonly mesh: THREE.Mesh;
  public readonly geometry: THREE.BufferGeometry;
  public readonly material: THREE.ShaderMaterial;

  private readonly nodes: WakeNode[] = [];
  private readonly foamParticles: FoamParticle[] = [];

  private lastEmitPos: Vec2 | null = null;
  private prevSternPos: Vec2 | null = null;
  // Per-phase spray accumulators (rates differ so each phase has its own counter)
  private phaseAcc1 = 0; // Phase 1: twin core streaks (propeller churn)
  private phaseAcc2 = 0; // Phase 2: inner V-wedge foam
  private phaseAcc3 = 0; // Phase 3: Kelvin spray fan ±15°–28°
  private phaseAcc4 = 0; // Phase 4: ambient water mist ±30°–48°

  // Pre-allocated flat buffers for dynamic GPU streaming
  private readonly positions = new Float32Array(MAX_VERTICES * 3);
  private readonly colors = new Float32Array(MAX_VERTICES * 4);
  private readonly uvs = new Float32Array(MAX_VERTICES * 2);

  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;

  public constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colAttr = new THREE.BufferAttribute(this.colors, 4);
    this.uvAttr = new THREE.BufferAttribute(this.uvs, 2);

    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("color", this.colAttr);
    this.geometry.setAttribute("uv", this.uvAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 color;
        varying vec4 vColor;
        varying vec2 vUv;
        void main() {
          vColor = color;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec4 vColor;
        varying vec2 vUv;
        void main() {
          float dist = length(vUv - vec2(0.5));
          // If UV is centered (ribbons), no circular falloff
          float circleAlpha = 1.0 - smoothstep(0.32, 0.50, dist);
          float alpha = vColor.a * circleAlpha;
          if (alpha <= 0.005) discard;
          gl_FragColor = vec4(vColor.rgb, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8; // Sits above water surface (0.0), below boat mesh (20)
  }

  /**
   * Main per-frame simulation update:
   * 1. Emit continuous trail nodes directly behind the stern along the boat's cruising path
   * 2. Spawn and simulate trailing stern foam bubbles
   * 3. Spawn subtle bow water froth
   * 4. Stream updated quads directly into GPU buffer attributes
   */
  public update(
    dt: number,
    _boatPos: Vec2,
    _bowPos: Vec2,
    sternPos: Vec2,
    velocity: Vec2,
    scale: number,
    weatherId: WeatherPresetId = "sunny",
  ): void {
    if (scale <= 0.001) {
      this.clear();
      return;
    }

    const currentSpeed = length(velocity);
    const minSpeedThreshold = 0.5;

    // Teleport / turn direction-flip guard:
    // If stern position leaped more than 8.0 * scale in one frame (e.g. facing direction flip),
    // immediately re-anchor without connecting a cross-boat ribbon or clumping particles.
    if (this.prevSternPos) {
      const stepDist = Math.hypot(
        sternPos.x - this.prevSternPos.x,
        sternPos.y - this.prevSternPos.y,
      );
      if (stepDist > 8.0 * scale) {
        this.lastEmitPos = { ...sternPos };
        this.prevSternPos = { ...sternPos };
      }
    }

    // 1. Emit Trail Ribbon Nodes along stern trajectory when boat is moving
    if (currentSpeed >= minSpeedThreshold) {
      const fwd = normalize(velocity);
      const norm = vec(-fwd.y, fwd.x);

      let shouldEmit = false;
      if (!this.lastEmitPos) {
        shouldEmit = true;
      } else {
        const distMoved = Math.hypot(
          sternPos.x - this.lastEmitPos.x,
          sternPos.y - this.lastEmitPos.y,
        );
        // Spacing between trail nodes: ~1.4 pond units for seamless ribbon
        if (distMoved >= Math.max(1.0, 1.4 * scale)) {
          shouldEmit = true;
        }
      }

      if (shouldEmit) {
        this.lastEmitPos = { ...sternPos };

        if (this.nodes.length >= MAX_WAKE_NODES) {
          this.nodes.shift();
        }

        this.nodes.push({
          pos: { ...sternPos },
          forward: fwd,
          normal: norm,
          age: 0,
          maxAge: 6.5 + Math.min(1.5, currentSpeed * 0.08),
          scale,
          speed: currentSpeed,
        });
      }

      // 2. SUB-FRAME INTERPOLATED 4-PHASE PARTICLE SPRAY (V-cone Kelvin wake matching Image 2)
      const pStern = this.prevSternPos ?? sternPos;

      const spawnWakeParticle = (
        phase: 1 | 2 | 3 | 4,
        spawnOrigin: Vec2,
        fanAngleRad: number,
        baseSpeed: number,
        size: number,
        maxAge: number,
      ): void => {
        if (this.foamParticles.length >= MAX_FOAM_PARTICLES) {
          this.foamParticles.shift();
        }
        // Rotate the backward direction (-fwd) by fanAngleRad
        const bx = -fwd.x;
        const by = -fwd.y;
        const cos = Math.cos(fanAngleRad);
        const sin = Math.sin(fanAngleRad);
        const dvx = bx * cos - by * sin;
        const dvy = bx * sin + by * cos;
        const jitter = 0.12 * baseSpeed;
        const speed = baseSpeed * (0.88 + Math.random() * 0.24);

        this.foamParticles.push({
          x: spawnOrigin.x,
          y: spawnOrigin.y,
          vx: dvx * speed + (Math.random() - 0.5) * jitter,
          vy: dvy * speed + (Math.random() - 0.5) * jitter,
          size,
          age: 0,
          maxAge,
          phase,
        });
      };

      // Helper to compute sub-frame interpolated base position along boat trajectory
      const getInterpolatedBase = (t: number): Vec2 => ({
        x: pStern.x + (sternPos.x - pStern.x) * t,
        y: pStern.y + (sternPos.y - pStern.y) * t,
      });

      // Phase 1 — Twin-track Core Churn (Twin propeller/rudder streams: tight, bright, crisp)
      // Alternates between port (+1.35) and starboard (-1.35) keel offsets
      const rate1 = Math.max(22, Math.min(currentSpeed * 1.5, 36));
      this.phaseAcc1 += dt * rate1;
      let count1 = 0;
      while (this.phaseAcc1 >= 1.0) {
        this.phaseAcc1 -= 1.0;
        const subT = clamp((count1 + Math.random()) * 0.35, 0, 1);
        count1++;
        const base = getInterpolatedBase(subT);
        const side = count1 % 2 === 0 ? 1 : -1;
        const keelOffset = (side * 1.35 + (Math.random() - 0.5) * 0.35) * scale;
        const origin: Vec2 = {
          x: base.x + norm.x * keelOffset,
          y: base.y + norm.y * keelOffset,
        };
        const angle = (Math.random() - 0.5) * 0.05; // ±~1.5° (nearly parallel twin streams)
        spawnWakeParticle(1, origin, angle, (2.2 + Math.random() * 0.9) * scale, (0.75 + Math.random() * 0.35) * scale, 0.48 + Math.random() * 0.26);
      }

      // Phase 2 — Inner V-Wedge Foam (Connecting twin streams along centerline)
      const rate2 = Math.max(14, Math.min(currentSpeed * 1.0, 24));
      this.phaseAcc2 += dt * rate2;
      let count2 = 0;
      while (this.phaseAcc2 >= 1.0) {
        this.phaseAcc2 -= 1.0;
        const subT = clamp((count2 + Math.random()) * 0.4, 0, 1);
        count2++;
        const base = getInterpolatedBase(subT);
        const sideOffset = (Math.random() - 0.5) * 1.6 * scale;
        const origin: Vec2 = {
          x: base.x + norm.x * sideOffset,
          y: base.y + norm.y * sideOffset,
        };
        const side = Math.random() < 0.5 ? 1 : -1;
        const angle = side * (0.08 + Math.random() * 0.12); // ~5°–11°
        spawnWakeParticle(2, origin, angle, (1.6 + Math.random() * 0.8) * scale, (0.95 + Math.random() * 0.45) * scale, 0.82 + Math.random() * 0.38);
      }

      // Phase 3 — Outer Kelvin Wake Crests (Spray cone fan expanding at ~13°–27°)
      const rate3 = Math.max(9, Math.min(currentSpeed * 0.75, 16));
      this.phaseAcc3 += dt * rate3;
      let count3 = 0;
      while (this.phaseAcc3 >= 1.0) {
        this.phaseAcc3 -= 1.0;
        const subT = clamp((count3 + Math.random()) * 0.5, 0, 1);
        count3++;
        const base = getInterpolatedBase(subT);
        const side = Math.random() < 0.5 ? 1 : -1;
        const sideOffset = side * (1.6 + Math.random() * 1.4) * scale;
        const origin: Vec2 = {
          x: base.x + norm.x * sideOffset,
          y: base.y + norm.y * sideOffset,
        };
        const angle = side * (0.22 + Math.random() * 0.24); // ~13°–27°
        spawnWakeParticle(3, origin, angle, (1.2 + Math.random() * 0.7) * scale, (1.15 + Math.random() * 0.55) * scale, 1.25 + Math.random() * 0.50);
      }

      // Phase 4 — Ambient Mist & Far Dissipation (Soft translucent droplets at ~20°–44°)
      const rate4 = Math.max(5, Math.min(currentSpeed * 0.5, 10));
      this.phaseAcc4 += dt * rate4;
      let count4 = 0;
      while (this.phaseAcc4 >= 1.0) {
        this.phaseAcc4 -= 1.0;
        const subT = clamp((count4 + Math.random()) * 0.6, 0, 1);
        count4++;
        const base = getInterpolatedBase(subT);
        const side = Math.random() < 0.5 ? 1 : -1;
        const sideOffset = side * (2.4 + Math.random() * 2.2) * scale;
        const origin: Vec2 = {
          x: base.x + norm.x * sideOffset,
          y: base.y + norm.y * sideOffset,
        };
        const angle = side * (0.35 + Math.random() * 0.42); // ~20°–44°
        spawnWakeParticle(4, origin, angle, (0.75 + Math.random() * 0.5) * scale, (1.30 + Math.random() * 0.65) * scale, 1.70 + Math.random() * 0.70);
      }

      this.prevSternPos = { ...sternPos };
    } else {
      // Idle decay when boat is stopped
      this.lastEmitPos = null;
      this.prevSternPos = null;
    }

    // 3. Age and update trail nodes
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      node.age += dt;
      if (node.age >= node.maxAge) {
        this.nodes.splice(i, 1);
      }
    }

    // 4. Age and update foam particles
    for (let i = this.foamParticles.length - 1; i >= 0; i--) {
      const p = this.foamParticles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.foamParticles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94; // Water viscous drag
      p.vy *= 0.94;
    }

    // 5. Stream geometry vertices to GPU
    this.commitGeometry(weatherId);
  }

  /**
   * Commit the cohesive wake trail ribbon, Kelvin outer crests, and foam particles into vertex arrays.
   */
  private commitGeometry(weatherId: WeatherPresetId): void {
    let vertCursor = 0;
    const weather = WAKE_WEATHER_TINTS[weatherId] ?? WAKE_WEATHER_TINTS.sunny;

    // Base colors:
    // Core: brilliant crisp white
    const cr = weather.r;
    const cg = weather.g;
    const cb = weather.b;

    // Fringe: stylized aqua/cyan foam tint (#67e8f9 / #a5f3fc)
    const frR = cr * 0.62;
    const frG = cg * 0.92;
    const frB = cb * 1.0;

    // Helper to write a quad (2 triangles = 6 vertices)
    const writeQuad = (
      p0: Vec2,
      p1: Vec2,
      p2: Vec2,
      p3: Vec2,
      c0: [number, number, number, number],
      c1: [number, number, number, number],
      c2: [number, number, number, number],
      c3: [number, number, number, number],
      uv0: [number, number] = [0.5, 0.5],
      uv1: [number, number] = [0.5, 0.5],
      uv2: [number, number] = [0.5, 0.5],
      uv3: [number, number] = [0.5, 0.5],
      z = 0.03,
    ): void => {
      if (vertCursor + 6 > MAX_VERTICES) return;

      const pts = [p0, p1, p2, p0, p2, p3];
      const cols = [c0, c1, c2, c0, c2, c3];
      const uvsList = [uv0, uv1, uv2, uv0, uv2, uv3];

      for (let i = 0; i < 6; i++) {
        const vIdx = vertCursor + i;
        const pIdx = vIdx * 3;
        const cIdx = vIdx * 4;
        const uIdx = vIdx * 2;

        this.positions[pIdx] = pts[i].x;
        this.positions[pIdx + 1] = pts[i].y;
        this.positions[pIdx + 2] = z;

        this.colors[cIdx] = cols[i][0];
        this.colors[cIdx + 1] = cols[i][1];
        this.colors[cIdx + 2] = cols[i][2];
        this.colors[cIdx + 3] = cols[i][3];

        this.uvs[uIdx] = uvsList[i][0];
        this.uvs[uIdx + 1] = uvsList[i][1];
      }
      vertCursor += 6;
    };

    // A. Render Twin-Track Core Ribbons + Centerline V-Wedge (matching ship wake top-view)
    const n = this.nodes.length;
    if (n >= 2) {
      for (let i = 0; i < n - 1; i++) {
        const nA = this.nodes[i];
        const nB = this.nodes[i + 1];

        // Jump guard: do not draw ribbon quad if distance is abnormal (e.g. turning/direction flip)
        const segDist = Math.hypot(nA.pos.x - nB.pos.x, nA.pos.y - nB.pos.y);
        if (segDist > 6.0 * Math.max(nA.scale, nB.scale)) continue;

        const tA = clamp(nA.age / nA.maxAge, 0, 1);
        const tB = clamp(nB.age / nB.maxAge, 0, 1);

        // Dimensions of twin tracks and center foam
        const keelOffA = 1.35 * nA.scale;
        const keelOffB = 1.35 * nB.scale;
        const trackHalfW_A = (0.55 + 0.35 * Math.pow(tA, 0.5)) * nA.scale;
        const trackHalfW_B = (0.55 + 0.35 * Math.pow(tB, 0.5)) * nB.scale;
        const centerHalfW_A = (0.85 + 0.65 * Math.pow(tA, 0.6)) * nA.scale;
        const centerHalfW_B = (0.85 + 0.65 * Math.pow(tB, 0.6)) * nB.scale;
        const outerHalfW_A = (2.8 + 1.6 * Math.pow(tA, 0.7)) * nA.scale;
        const outerHalfW_B = (2.8 + 1.6 * Math.pow(tB, 0.7)) * nB.scale;

        // Smooth decay
        const alphaA = clamp(1.0 - tA, 0, 1) * (1.0 - Math.pow(tA, 1.4)) * 0.88;
        const alphaB = clamp(1.0 - tB, 0, 1) * (1.0 - Math.pow(tB, 1.4)) * 0.88;

        if (alphaA <= 0.01 && alphaB <= 0.01) continue;

        const cA = nA.pos;
        const cB = nB.pos;

        // Port track center & edges
        const portCA = vec(cA.x + nA.normal.x * keelOffA, cA.y + nA.normal.y * keelOffA);
        const portCB = vec(cB.x + nB.normal.x * keelOffB, cB.y + nB.normal.y * keelOffB);
        const portLA = vec(portCA.x + nA.normal.x * trackHalfW_A, portCA.y + nA.normal.y * trackHalfW_A);
        const portLB = vec(portCB.x + nB.normal.x * trackHalfW_B, portCB.y + nB.normal.y * trackHalfW_B);
        const portRA = vec(portCA.x - nA.normal.x * trackHalfW_A, portCA.y - nA.normal.y * trackHalfW_A);
        const portRB = vec(portCB.x - nB.normal.x * trackHalfW_B, portCB.y - nB.normal.y * trackHalfW_B);

        // Starboard track center & edges
        const starCA = vec(cA.x - nA.normal.x * keelOffA, cA.y - nA.normal.y * keelOffA);
        const starCB = vec(cB.x - nB.normal.x * keelOffB, cB.y - nB.normal.y * keelOffB);
        const starLA = vec(starCA.x + nA.normal.x * trackHalfW_A, starCA.y + nA.normal.y * trackHalfW_A);
        const starLB = vec(starCB.x + nB.normal.x * trackHalfW_B, starCB.y + nB.normal.y * trackHalfW_B);
        const starRA = vec(starCA.x - nA.normal.x * trackHalfW_A, starCA.y - nA.normal.y * trackHalfW_A);
        const starRB = vec(starCB.x - nB.normal.x * trackHalfW_B, starCB.y - nB.normal.y * trackHalfW_B);

        // Center foam bounds
        const midLA = vec(cA.x + nA.normal.x * centerHalfW_A, cA.y + nA.normal.y * centerHalfW_A);
        const midLB = vec(cB.x + nB.normal.x * centerHalfW_B, cB.y + nB.normal.y * centerHalfW_B);
        const midRA = vec(cA.x - nA.normal.x * centerHalfW_A, cA.y - nA.normal.y * centerHalfW_A);
        const midRB = vec(cB.x - nB.normal.x * centerHalfW_B, cB.y - nB.normal.y * centerHalfW_B);

        // Outer fringe bounds
        const outLA = vec(cA.x + nA.normal.x * outerHalfW_A, cA.y + nA.normal.y * outerHalfW_A);
        const outLB = vec(cB.x + nB.normal.x * outerHalfW_B, cB.y + nB.normal.y * outerHalfW_B);
        const outRA = vec(cA.x - nA.normal.x * outerHalfW_A, cA.y - nA.normal.y * outerHalfW_A);
        const outRB = vec(cB.x - nB.normal.x * outerHalfW_B, cB.y - nB.normal.y * outerHalfW_B);

        // 1. Port Core Track Quad (Sharp bright white)
        writeQuad(
          portLA, portRA, portRB, portLB,
          [cr, cg, cb, alphaA * 0.95],
          [cr, cg, cb, alphaA * 0.95],
          [cr, cg, cb, alphaB * 0.95],
          [cr, cg, cb, alphaB * 0.95],
        );

        // 2. Starboard Core Track Quad (Sharp bright white)
        writeQuad(
          starLA, starRA, starRB, starLB,
          [cr, cg, cb, alphaA * 0.95],
          [cr, cg, cb, alphaA * 0.95],
          [cr, cg, cb, alphaB * 0.95],
          [cr, cg, cb, alphaB * 0.95],
        );

        // 3. Center Foam V-Wedge Quad (Softer white filling)
        writeQuad(
          midLA, midRA, midRB, midLB,
          [cr, cg, cb, alphaA * 0.65],
          [cr, cg, cb, alphaA * 0.65],
          [cr, cg, cb, alphaB * 0.65],
          [cr, cg, cb, alphaB * 0.65],
        );

        // 4. Left Outer Fringe (fading smoothly to water)
        writeQuad(
          outLA, portLA, portLB, outLB,
          [frR, frG, frB, 0.0],
          [cr, cg, cb, alphaA * 0.40],
          [cr, cg, cb, alphaB * 0.40],
          [frR, frG, frB, 0.0],
        );

        // 5. Right Outer Fringe (fading smoothly to water)
        writeQuad(
          starRA, outRA, outRB, starRB,
          [cr, cg, cb, alphaA * 0.40],
          [frR, frG, frB, 0.0],
          [frR, frG, frB, 0.0],
          [cr, cg, cb, alphaB * 0.40],
        );
      }
    }

    // B. Render 4-phase spray particles (Kelvin wake V-cone spray matching Image 2)
    const phaseAlphaCeil = [0, 0.95, 0.75, 0.48, 0.22] as const;

    for (const p of this.foamParticles) {
      const lifeT = clamp(p.age / p.maxAge, 0, 1);
      // Bell-curve aeration: grows quickly, lingers, then contracts/dissolves
      const currentRadius = p.size * (0.65 + Math.sin(lifeT * Math.PI) * 0.50);
      const fadePow = p.phase >= 3 ? 1.15 : 1.40;
      const alpha = (1.0 - Math.pow(lifeT, fadePow)) * phaseAlphaCeil[p.phase];

      if (alpha <= 0.005) continue;

      const p0 = vec(p.x - currentRadius, p.y - currentRadius);
      const p1 = vec(p.x + currentRadius, p.y - currentRadius);
      const p2 = vec(p.x + currentRadius, p.y + currentRadius);
      const p3 = vec(p.x - currentRadius, p.y + currentRadius);

      const col: [number, number, number, number] = [cr, cg, cb, alpha];

      writeQuad(
        p0, p1, p2, p3,
        col, col, col, col,
        [0.0, 0.0],
        [1.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
        0.04, // Slightly above ribbon
      );
    }

    this.geometry.setDrawRange(0, vertCursor);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
  }

  public clear(): void {
    this.nodes.length = 0;
    this.foamParticles.length = 0;
    this.lastEmitPos = null;
    this.prevSternPos = null;
    this.phaseAcc1 = 0;
    this.phaseAcc2 = 0;
    this.phaseAcc3 = 0;
    this.phaseAcc4 = 0;
    this.geometry.setDrawRange(0, 0);
  }

  public getNodes(): readonly WakeNode[] {
    return this.nodes;
  }

  public getFoamParticles(): readonly FoamParticle[] {
    return this.foamParticles;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
