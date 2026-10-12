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
  isStern: boolean;
}

const MAX_WAKE_NODES = 48;
const MAX_FOAM_PARTICLES = 64;

// Capacity calculation:
// Each segment between 2 nodes creates 2 quads (1 port ribbon quad + 1 starboard ribbon quad) = 12 vertices.
// Max ribbon segments = (MAX_WAKE_NODES - 1) * 12 = 47 * 12 = 564 vertices.
// Foam particles = MAX_FOAM_PARTICLES * 6 = 384 vertices.
// Total vertices = 564 + 384 = 948 vertices.
const MAX_VERTICES = (MAX_WAKE_NODES - 1) * 12 + MAX_FOAM_PARTICLES * 6;

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
  private bowSplashAccumulator = 0;
  private sternBubbleAccumulator = 0;

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
   * 1. Detect movement and emit V-shaped wake ribbon nodes
   * 2. Spawn and simulate bow wave splash foam
   * 3. Spawn and simulate stern propeller / rudder bubbles
   * 4. Stream updated quads directly into GPU buffer attributes
   */
  public update(
    dt: number,
    boatPos: Vec2,
    bowPos: Vec2,
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
    const minSpeedThreshold = 1.2;

    // 1. Emit Kelvin Wake Ribbon Nodes when boat is in motion
    if (currentSpeed >= minSpeedThreshold) {
      const fwd = normalize(velocity);
      const norm = vec(-fwd.y, fwd.x);

      let shouldEmit = false;
      if (!this.lastEmitPos) {
        shouldEmit = true;
      } else {
        const distMoved = Math.hypot(
          boatPos.x - this.lastEmitPos.x,
          boatPos.y - this.lastEmitPos.y,
        );
        // Spacing between ribbon nodes: ~2.8 pond units for buttery smooth curved ribbons
        if (distMoved >= Math.max(2.2, 2.8 * scale)) {
          shouldEmit = true;
        }
      }

      if (shouldEmit) {
        this.lastEmitPos = { ...boatPos };

        if (this.nodes.length >= MAX_WAKE_NODES) {
          this.nodes.shift();
        }

        this.nodes.push({
          pos: { ...bowPos },
          forward: fwd,
          normal: norm,
          age: 0,
          maxAge: 1.4 + Math.min(0.6, currentSpeed * 0.02), // Lasts longer at higher speeds
          scale,
          speed: currentSpeed,
        });
      }

      // 2. Spawn Bow Splash Foam
      this.bowSplashAccumulator += dt * Math.min(currentSpeed * 0.9, 32.0);
      while (this.bowSplashAccumulator >= 1.0) {
        this.bowSplashAccumulator -= 1.0;
        if (this.foamParticles.length >= MAX_FOAM_PARTICLES) {
          this.foamParticles.shift();
        }

        // Lateral spread at bow (port or starboard spray)
        const side = Math.random() < 0.5 ? 1 : -1;
        const sprayAngle = (Math.random() - 0.5) * 0.8;
        const spraySpeed = (currentSpeed * 0.35 + 4.0 + Math.random() * 8.0) * scale;

        const sprayVx = fwd.x * spraySpeed * 0.2 + (norm.x * side + fwd.x * sprayAngle) * spraySpeed * 0.8;
        const sprayVy = fwd.y * spraySpeed * 0.2 + (norm.y * side + fwd.y * sprayAngle) * spraySpeed * 0.8;

        this.foamParticles.push({
          x: bowPos.x + norm.x * side * (3.5 * scale) + (Math.random() - 0.5) * (2.0 * scale),
          y: bowPos.y + norm.y * side * (3.5 * scale) + (Math.random() - 0.5) * (2.0 * scale),
          vx: sprayVx,
          vy: sprayVy,
          size: (3.0 + Math.random() * 2.8) * scale,
          age: 0,
          maxAge: 0.35 + Math.random() * 0.25,
          isStern: false,
        });
      }

      // 3. Spawn Stern Foam Bubbles
      this.sternBubbleAccumulator += dt * Math.min(currentSpeed * 0.5, 18.0);
      while (this.sternBubbleAccumulator >= 1.0) {
        this.sternBubbleAccumulator -= 1.0;
        if (this.foamParticles.length >= MAX_FOAM_PARTICLES) {
          this.foamParticles.shift();
        }

        const sternSpeed = (2.0 + Math.random() * 4.0) * scale;
        this.foamParticles.push({
          x: sternPos.x + (Math.random() - 0.5) * (4.0 * scale),
          y: sternPos.y + (Math.random() - 0.5) * (4.0 * scale),
          vx: -fwd.x * sternSpeed + (Math.random() - 0.5) * 2.0,
          vy: -fwd.y * sternSpeed + (Math.random() - 0.5) * 2.0,
          size: (2.0 + Math.random() * 2.2) * scale,
          age: 0,
          maxAge: 0.75 + Math.random() * 0.45,
          isStern: true,
        });
      }
    } else {
      // Idle decay when vessel is stopped
      this.lastEmitPos = null;
    }

    // 4. Age and update existing ribbon nodes
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      node.age += dt;
      if (node.age >= node.maxAge) {
        this.nodes.splice(i, 1);
      }
    }

    // 5. Age and update foam particles
    for (let i = this.foamParticles.length - 1; i >= 0; i--) {
      const p = this.foamParticles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.foamParticles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.90; // Water viscous drag
      p.vy *= 0.90;
    }

    // 6. Stream geometry vertices to GPU
    this.commitGeometry(weatherId);
  }

  /**
   * Commit all active wake ribbons and foam particles into vertex arrays.
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

    // A. Render Port & Starboard V-shaped Kelvin Wake Ribbons
    const n = this.nodes.length;
    if (n >= 2) {
      for (let i = 0; i < n - 1; i++) {
        const nA = this.nodes[i];
        const nB = this.nodes[i + 1];

        const tA = clamp(nA.age / nA.maxAge, 0, 1);
        const tB = clamp(nB.age / nB.maxAge, 0, 1);

        // Kelvin wake envelope: lateral expansion increases with age^(0.65)
        const spreadA = (5.5 + 24.0 * Math.pow(tA, 0.65)) * nA.scale;
        const spreadB = (5.5 + 24.0 * Math.pow(tB, 0.65)) * nB.scale;

        // Ribbon thickness tapers as wave disperses
        const thickA = (2.6 * (1.0 - tA * 0.45)) * nA.scale;
        const thickB = (2.6 * (1.0 - tB * 0.45)) * nB.scale;

        // Opacity curve: swift rise, long graceful fade-out
        const alphaA = clamp(Math.sin(tA * Math.PI) * 1.15, 0, 1) * (1.0 - Math.pow(tA, 1.8)) * 0.92;
        const alphaB = clamp(Math.sin(tB * Math.PI) * 1.15, 0, 1) * (1.0 - Math.pow(tB, 1.8)) * 0.92;

        if (alphaA <= 0.01 && alphaB <= 0.01) continue;

        // Port (Left) Ribbon Arm
        const portCoreA = vec(nA.pos.x + nA.normal.x * spreadA, nA.pos.y + nA.normal.y * spreadA);
        const portCoreB = vec(nB.pos.x + nB.normal.x * spreadB, nB.pos.y + nB.normal.y * spreadB);

        const portInnerA = vec(portCoreA.x - nA.normal.x * thickA, portCoreA.y - nA.normal.y * thickA);
        const portOuterA = vec(portCoreA.x + nA.normal.x * thickA, portCoreA.y + nA.normal.y * thickA);
        const portInnerB = vec(portCoreB.x - nB.normal.x * thickB, portCoreB.y - nB.normal.y * thickB);
        const portOuterB = vec(portCoreB.x + nB.normal.x * thickB, portCoreB.y + nB.normal.y * thickB);

        writeQuad(
          portInnerA,
          portOuterA,
          portOuterB,
          portInnerB,
          [cr, cg, cb, alphaA],
          [frR, frG, frB, alphaA * 0.55],
          [frR, frG, frB, alphaB * 0.55],
          [cr, cg, cb, alphaB],
        );

        // Starboard (Right) Ribbon Arm
        const starCoreA = vec(nA.pos.x - nA.normal.x * spreadA, nA.pos.y - nA.normal.y * spreadA);
        const starCoreB = vec(nB.pos.x - nB.normal.x * spreadB, nB.pos.y - nB.normal.y * spreadB);

        const starInnerA = vec(starCoreA.x + nA.normal.x * thickA, starCoreA.y + nA.normal.y * thickA);
        const starOuterA = vec(starCoreA.x - nA.normal.x * thickA, starCoreA.y - nA.normal.y * thickA);
        const starInnerB = vec(starCoreB.x + nB.normal.x * thickB, starCoreB.y + nB.normal.y * thickB);
        const starOuterB = vec(starCoreB.x - nB.normal.x * thickB, starCoreB.y - nB.normal.y * thickB);

        writeQuad(
          starInnerA,
          starOuterA,
          starOuterB,
          starInnerB,
          [cr, cg, cb, alphaA],
          [frR, frG, frB, alphaA * 0.55],
          [frR, frG, frB, alphaB * 0.55],
          [cr, cg, cb, alphaB],
        );
      }
    }

    // B. Render Foam & Splash Particles (Soft circular pixel billows)
    for (const p of this.foamParticles) {
      const lifeT = clamp(p.age / p.maxAge, 0, 1);
      // Particle expansion then contraction
      const currentRadius = p.size * (0.6 + Math.sin(lifeT * Math.PI) * 0.55);
      const alpha = (1.0 - Math.pow(lifeT, 1.5)) * (p.isStern ? 0.72 : 0.95);

      if (alpha <= 0.01) continue;

      const p0 = vec(p.x - currentRadius, p.y - currentRadius);
      const p1 = vec(p.x + currentRadius, p.y - currentRadius);
      const p2 = vec(p.x + currentRadius, p.y + currentRadius);
      const p3 = vec(p.x - currentRadius, p.y + currentRadius);

      const col: [number, number, number, number] = p.isStern
        ? [frR, frG, frB, alpha]
        : [cr, cg, cb, alpha];

      writeQuad(
        p0,
        p1,
        p2,
        p3,
        col,
        col,
        col,
        col,
        [0.0, 0.0],
        [1.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
        0.04, // Slightly above ribbons
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
