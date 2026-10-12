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

const MAX_WAKE_NODES = 64;
const MAX_FOAM_PARTICLES = 96;

// Capacity calculation:
// Each segment between 2 nodes creates:
// - 2 quads for central wake ribbon = 12 vertices
// - 2 quads for Kelvin wake outer crests = 12 vertices
// Total per segment = 24 vertices.
// Max ribbon segments = (MAX_WAKE_NODES - 1) * 24 = 63 * 24 = 1512 vertices.
// Foam particles = MAX_FOAM_PARTICLES * 6 = 576 vertices.
// Total vertices = 1512 + 576 = 2088 vertices.
const MAX_VERTICES = (MAX_WAKE_NODES - 1) * 24 + MAX_FOAM_PARTICLES * 6;

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
  private sternChurnAccumulator = 0;

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
        // Spacing between trail nodes: ~1.6 pond units for smooth continuous trail
        if (distMoved >= Math.max(1.2, 1.6 * scale)) {
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
          maxAge: 6.8 + Math.min(1.5, currentSpeed * 0.08), // Long, elegant lingering trail following boat
          scale,
          speed: currentSpeed,
        });
      }

      // 2. STERN INDICATOR: Continuous Propeller / Rudder Churn & Froth at Stern
      // Acts as an unmistakable visual indicator for where the stern is
      this.sternChurnAccumulator += dt * Math.max(6.0, Math.min(currentSpeed * 1.1, 22.0));
      while (this.sternChurnAccumulator >= 1.0) {
        this.sternChurnAccumulator -= 1.0;
        if (this.foamParticles.length >= MAX_FOAM_PARTICLES) {
          this.foamParticles.shift();
        }

        const sternSpeed = (1.5 + Math.random() * 2.8) * scale;
        const sideOffset = (Math.random() - 0.5) * (3.6 * scale);

        this.foamParticles.push({
          x: sternPos.x + norm.x * sideOffset,
          y: sternPos.y + norm.y * sideOffset,
          vx: -fwd.x * sternSpeed + norm.x * (Math.random() - 0.5) * 1.4,
          vy: -fwd.y * sternSpeed + norm.y * (Math.random() - 0.5) * 1.4,
          size: (2.2 + Math.random() * 2.6) * scale,
          age: 0,
          maxAge: 0.95 + Math.random() * 0.45,
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

    // A. Render Cohesive Frothy Wake Plume Stream (Directly trailing behind stern, matching reference image)
    const n = this.nodes.length;
    if (n >= 2) {
      for (let i = 0; i < n - 1; i++) {
        const nA = this.nodes[i];
        const nB = this.nodes[i + 1];

        const tA = clamp(nA.age / nA.maxAge, 0, 1);
        const tB = clamp(nB.age / nB.maxAge, 0, 1);

        // Volumetric plume dimensions:
        // Core width starts at inner propeller wake (~2.4 units), expanding gently
        const coreHalfW_A = (2.4 + 1.8 * Math.pow(tA, 0.5)) * nA.scale;
        const coreHalfW_B = (2.4 + 1.8 * Math.pow(tB, 0.5)) * nB.scale;

        // Outer diffused frothy plume width (matches boat stern width ~4.8 units, slowly diffusing to ~7.8 units)
        const outerHalfW_A = (4.8 + 3.2 * Math.pow(tA, 0.6)) * (1.0 - 0.12 * tA) * nA.scale;
        const outerHalfW_B = (4.8 + 3.2 * Math.pow(tB, 0.6)) * (1.0 - 0.12 * tB) * nB.scale;

        // Smooth volumetric decay: dense milky foam behind vessel, dissolving gracefully into blue water
        const alphaA = clamp(1.0 - tA, 0, 1) * (1.0 - Math.pow(tA, 1.8)) * 0.88;
        const alphaB = clamp(1.0 - tB, 0, 1) * (1.0 - Math.pow(tB, 1.8)) * 0.88;

        if (alphaA <= 0.01 && alphaB <= 0.01) continue;

        const cA = nA.pos;
        const cB = nB.pos;

        // Core boundaries
        const coreLA = vec(cA.x + nA.normal.x * coreHalfW_A, cA.y + nA.normal.y * coreHalfW_A);
        const coreLB = vec(cB.x + nB.normal.x * coreHalfW_B, cB.y + nB.normal.y * coreHalfW_B);
        const coreRA = vec(cA.x - nA.normal.x * coreHalfW_A, cA.y - nA.normal.y * coreHalfW_A);
        const coreRB = vec(cB.x - nB.normal.x * coreHalfW_B, cB.y - nB.normal.y * coreHalfW_B);

        // Outer diffused plume boundaries
        const outLA = vec(cA.x + nA.normal.x * outerHalfW_A, cA.y + nA.normal.y * outerHalfW_A);
        const outLB = vec(cB.x + nB.normal.x * outerHalfW_B, cB.y + nB.normal.y * outerHalfW_B);
        const outRA = vec(cA.x - nA.normal.x * outerHalfW_A, cA.y - nA.normal.y * outerHalfW_A);
        const outRB = vec(cB.x - nB.normal.x * outerHalfW_B, cB.y - nB.normal.y * outerHalfW_B);

        // 1. Left Core Quad (Dense white center to mid foam)
        writeQuad(
          coreLA, cA, cB, coreLB,
          [cr, cg, cb, alphaA * 0.70],
          [cr, cg, cb, alphaA],
          [cr, cg, cb, alphaB],
          [cr, cg, cb, alphaB * 0.70],
        );

        // 2. Right Core Quad (Center to mid foam)
        writeQuad(
          cA, coreRA, coreRB, cB,
          [cr, cg, cb, alphaA],
          [cr, cg, cb, alphaA * 0.70],
          [cr, cg, cb, alphaB * 0.70],
          [cr, cg, cb, alphaB],
        );

        // 3. Left Diffuse Fringe Quad (Mid foam fading smoothly to water)
        writeQuad(
          outLA, coreLA, coreLB, outLB,
          [frR, frG, frB, 0.0],
          [cr, cg, cb, alphaA * 0.70],
          [cr, cg, cb, alphaB * 0.70],
          [frR, frG, frB, 0.0],
        );

        // 4. Right Diffuse Fringe Quad (Mid foam fading smoothly to water)
        writeQuad(
          coreRA, outRA, outRB, coreRB,
          [cr, cg, cb, alphaA * 0.70],
          [frR, frG, frB, 0.0],
          [frR, frG, frB, 0.0],
          [cr, cg, cb, alphaB * 0.70],
        );
      }
    }

    // B. Render Foam Bubbles (Bow Spray & Stern Churn Indicator)
    for (const p of this.foamParticles) {
      const lifeT = clamp(p.age / p.maxAge, 0, 1);
      const currentRadius = p.size * (0.65 + Math.sin(lifeT * Math.PI) * 0.5);
      const alpha = (1.0 - Math.pow(lifeT, 1.4)) * (p.isStern ? 0.90 : 0.95);

      if (alpha <= 0.01) continue;

      const p0 = vec(p.x - currentRadius, p.y - currentRadius);
      const p1 = vec(p.x + currentRadius, p.y - currentRadius);
      const p2 = vec(p.x + currentRadius, p.y + currentRadius);
      const p3 = vec(p.x - currentRadius, p.y + currentRadius);

      const col: [number, number, number, number] = p.isStern
        ? [cr, cg, cb, alpha]
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
