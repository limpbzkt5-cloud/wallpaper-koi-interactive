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
// Each segment between 2 nodes creates 2 quads (left half + right half trail ribbon) = 12 vertices.
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
    const minSpeedThreshold = 0.8;

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
        // Spacing between trail nodes: ~2.0 pond units for continuous, unbroken trail ribbon
        if (distMoved >= Math.max(1.6, 2.0 * scale)) {
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
          maxAge: 2.2 + Math.min(0.8, currentSpeed * 0.05), // Smooth, lingering trail behind boat
          scale,
          speed: currentSpeed,
        });
      }

      // 2. Spawn Trailing Stern Foam Bubbles
      this.sternBubbleAccumulator += dt * Math.min(currentSpeed * 0.7, 18.0);
      while (this.sternBubbleAccumulator >= 1.0) {
        this.sternBubbleAccumulator -= 1.0;
        if (this.foamParticles.length >= MAX_FOAM_PARTICLES) {
          this.foamParticles.shift();
        }

        const sternSpeed = (1.2 + Math.random() * 2.5) * scale;
        const sideOffset = (Math.random() - 0.5) * (3.8 * scale);

        this.foamParticles.push({
          x: sternPos.x + norm.x * sideOffset,
          y: sternPos.y + norm.y * sideOffset,
          vx: -fwd.x * sternSpeed + (Math.random() - 0.5) * 1.0,
          vy: -fwd.y * sternSpeed + (Math.random() - 0.5) * 1.0,
          size: (1.8 + Math.random() * 2.0) * scale,
          age: 0,
          maxAge: 1.0 + Math.random() * 0.5,
          isStern: true,
        });
      }
    } else {
      // Idle decay when boat is stopped
      this.lastEmitPos = null;
    }

    // 4. Age and update trail nodes
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
      p.vx *= 0.92; // Water viscous drag
      p.vy *= 0.92;
    }

    // 6. Stream geometry vertices to GPU
    this.commitGeometry(weatherId);
  }

  /**
   * Commit the cohesive wake trail ribbon and foam particles into vertex arrays.
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

    // A. Render Cohesive Wake Trail Ribbon (Centered on stern wake path)
    const n = this.nodes.length;
    if (n >= 2) {
      for (let i = 0; i < n - 1; i++) {
        const nA = this.nodes[i];
        const nB = this.nodes[i + 1];

        const tA = clamp(nA.age / nA.maxAge, 0, 1);
        const tB = clamp(nB.age / nB.maxAge, 0, 1);

        // Sleek trail ribbon: starts at stern width (~3.8 units half-width), expands slightly into soft foam
        const halfWidthA = (3.8 + 2.8 * Math.pow(tA, 0.5)) * (1.0 - 0.22 * tA) * nA.scale;
        const halfWidthB = (3.8 + 2.8 * Math.pow(tB, 0.5)) * (1.0 - 0.22 * tB) * nB.scale;

        // Opacity curve: begins smoothly right at the stern, fading gracefully into the pond wake
        const alphaA = clamp(1.0 - tA, 0, 1) * (1.0 - Math.pow(tA, 1.8)) * 0.78;
        const alphaB = clamp(1.0 - tB, 0, 1) * (1.0 - Math.pow(tB, 1.8)) * 0.78;

        if (alphaA <= 0.01 && alphaB <= 0.01) continue;

        // Center spine vertices
        const cA = nA.pos;
        const cB = nB.pos;

        // Left outer vertices
        const lA = vec(cA.x + nA.normal.x * halfWidthA, cA.y + nA.normal.y * halfWidthA);
        const lB = vec(cB.x + nB.normal.x * halfWidthB, cB.y + nB.normal.y * halfWidthB);

        // Right outer vertices
        const rA = vec(cA.x - nA.normal.x * halfWidthA, cA.y - nA.normal.y * halfWidthA);
        const rB = vec(cB.x - nB.normal.x * halfWidthB, cB.y - nB.normal.y * halfWidthB);

        // Left Half Quad (from left edge to center spine): white center, cyan outer edge
        writeQuad(
          lA,
          cA,
          cB,
          lB,
          [frR, frG, frB, alphaA * 0.35],
          [cr, cg, cb, alphaA],
          [cr, cg, cb, alphaB],
          [frR, frG, frB, alphaB * 0.35],
        );

        // Right Half Quad (from center spine to right edge): white center, cyan outer edge
        writeQuad(
          cA,
          rA,
          rB,
          cB,
          [cr, cg, cb, alphaA],
          [frR, frG, frB, alphaA * 0.35],
          [frR, frG, frB, alphaB * 0.35],
          [cr, cg, cb, alphaB],
        );
      }
    }

    // B. Render Foam Bubbles along the trail channel
    for (const p of this.foamParticles) {
      const lifeT = clamp(p.age / p.maxAge, 0, 1);
      const currentRadius = p.size * (0.65 + Math.sin(lifeT * Math.PI) * 0.5);
      const alpha = (1.0 - Math.pow(lifeT, 1.4)) * (p.isStern ? 0.85 : 0.65);

      if (alpha <= 0.01) continue;

      const p0 = vec(p.x - currentRadius, p.y - currentRadius);
      const p1 = vec(p.x + currentRadius, p.y - currentRadius);
      const p2 = vec(p.x + currentRadius, p.y + currentRadius);
      const p3 = vec(p.x - currentRadius, p.y + currentRadius);

      const col: [number, number, number, number] = p.isStern
        ? [cr, cg, cb, alpha]
        : [frR, frG, frB, alpha];

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
        0.04, // Slightly above trail ribbon
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
