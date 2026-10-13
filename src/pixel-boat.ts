import * as THREE from "three";
import { CANVAS_WIDTH, CANVAS_HEIGHT, FISH } from "./config";
import { add, clamp, length, mul, normalize, sub, type Vec2, vec } from "./math";
import type { WeatherPresetId } from "./weather";
import type { RippleSystem } from "./ripple-system";
import type { School } from "./school";
import type { Koi } from "./koi";
import { BoatWakeTrail } from "./boat-wake";

export type BoatInteractionZone = "music" | "food" | "anchor" | null;
export type BoatPositionPreset = "right" | "left" | "top-right" | "bottom-center";
export type BoatState = "orbiting" | "dragging" | "returning" | "anchored";

export interface PixelBoatOptions {
  scale: number; // 0.0 to 2.0 (0.0 = hidden)
  position: Vec2;
  positionPreset: BoatPositionPreset;
}

// Boat base size in pond units (enlarged for rich detail & crisp media control menu)
export const BOAT_BASE_WIDTH = 64.0;
export const BOAT_BASE_HEIGHT = 42.0;

// Pixel Art Canvas dimensions (offscreen integer grid for crisp nearest-neighbor rendering)
const SPRITE_PX_WIDTH = 80;
const SPRITE_PX_HEIGHT = 52;

// Max capacity for dynamic particles
const MAX_NOTES = 16;
const MAX_PELLETS = 32;

export interface MusicNoteParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  type: 0 | 1; // 0 = single note ♪, 1 = beamed note ♫
  size: number;
  driftPhase: number;
}

export interface FoodPelletParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // Height above water (z > 0 in air, z = 0 on surface)
  vz: number;
  state: "air" | "floating" | "sinking";
  age: number;
  maxAge: number;
  colorIdx: number;
}

const WEATHER_TINTS: Record<WeatherPresetId, THREE.Color> = {
  sunny: new THREE.Color(1.0, 0.98, 0.94),
  "deep-clear": new THREE.Color(0.96, 1.0, 0.98),
  overcast: new THREE.Color(0.88, 0.90, 0.92),
  mist: new THREE.Color(0.85, 0.93, 0.92),
  sunset: new THREE.Color(1.06, 0.88, 0.76),
  moonlight: new THREE.Color(0.72, 0.78, 0.98),
  rain: new THREE.Color(0.82, 0.86, 0.90),
};

const WEATHER_SHADOW_OFFSETS: Record<WeatherPresetId, { x: number; y: number; opacity: number }> = {
  sunny: { x: 2.2, y: 3.8, opacity: 0.36 },
  "deep-clear": { x: 2.6, y: 4.0, opacity: 0.38 },
  overcast: { x: 0.8, y: 2.2, opacity: 0.22 },
  mist: { x: 0.5, y: 1.8, opacity: 0.16 },
  sunset: { x: 4.2, y: 5.0, opacity: 0.42 },
  moonlight: { x: 1.0, y: 2.8, opacity: 0.22 },
  rain: { x: 0.6, y: 2.0, opacity: 0.18 },
};

const PELLET_PALETTE: readonly THREE.Color[] = [
  new THREE.Color("#fd7e14"),
  new THREE.Color("#e8590c"),
  new THREE.Color("#ffa94d"),
  new THREE.Color("#f76707"),
];

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
    save: () => {},
    restore: () => {},
    imageSmoothingEnabled: false,
    fillStyle: "#000",
  } as unknown as CanvasRenderingContext2D;
  const mockCanvas = {
    width,
    height,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;
  return { canvas: mockCanvas, ctx: mockCtx };
}

export class PixelBoat {
  public readonly group = new THREE.Group();
  public readonly shadowGroup = new THREE.Group();

  public options: PixelBoatOptions = {
    scale: 1.0,
    position: vec(CANVAS_WIDTH * 0.74, CANVAS_HEIGHT * 0.54), // Default scenic position (~355, 145)
    positionPreset: "right",
  };

  // Main Boat Mesh & Offscreen Canvas
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;
  private readonly shadowMesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;

  // Music Notes Quads & Atlas
  private readonly notesCanvas: HTMLCanvasElement;
  private readonly notesTexture: THREE.CanvasTexture;
  private readonly noteGeometry: THREE.BufferGeometry;
  private readonly noteMesh: THREE.Mesh;
  private readonly notePositions: Float32Array;
  private readonly noteUvs: Float32Array;
  private readonly noteColors: Float32Array;
  private readonly notePosAttr: THREE.BufferAttribute;
  private readonly noteUvAttr: THREE.BufferAttribute;
  private readonly noteColAttr: THREE.BufferAttribute;

  // Food Pellets Quads
  private readonly pelletGeometry: THREE.BufferGeometry;
  private readonly pelletMesh: THREE.Mesh;
  private readonly pelletPositions: Float32Array;
  private readonly pelletColors: Float32Array;
  private readonly pelletPosAttr: THREE.BufferAttribute;
  private readonly pelletColAttr: THREE.BufferAttribute;

  // Pellet Shadows
  private readonly pelletShadowGeometry: THREE.BufferGeometry;
  private readonly pelletShadowMesh: THREE.Mesh;
  private readonly pelletShadowPositions: Float32Array;
  private readonly pelletShadowColors: Float32Array;
  private readonly pelletShadowPosAttr: THREE.BufferAttribute;
  private readonly pelletShadowColAttr: THREE.BufferAttribute;

  // Particle active arrays
  private readonly notes: MusicNoteParticle[] = [];
  private readonly pellets: FoodPelletParticle[] = [];
  private lastNoteSpawnTime = 0;

  // Audio & Animation states
  private isMusicPlaying = false;
  private isSystemAudioPlaying = false;
  private isMediaSessionPlaying = false;
  private audioEnergy = 0.0;
  private currentTrackName = "River Serenade";
  private buttonPressTimer = 0;
  private vinylRotationFrame = 0;
  private lastVinylFrameTime = 0;
  private foodRecoilTimer = 0;
  private foodCallNudgeTimer = 0;

  // Physics & Oscillation states
  private bobY = 0;
  private pitchAngle = 0;
  private targetY = 0;
  private currentY = 0;
  private targetAngle = 0;
  private currentAngle = 0;

  // Navigation & Orbiting states
  public state: BoatState = "orbiting";
  public orbitAngle = 0;
  public orbitSpeed = 0.11; // Calm, peaceful cruising (~57 seconds per complete circuit)
  public speedMultiplier = 1.0; // Configurable orbit speed slider
  public orbitRadiusX = 96.0; // Horizontal orbit around pond center
  public orbitRadiusY = 52.0; // Vertical orbit around pond center
  public orbitCenter: Vec2 = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.48);
  public returnSpeed = 20.0; // Gentle return velocity when dropped
  public facingLeft = true;
  private wakeTimer = 0;
  public readonly wakeTrail = new BoatWakeTrail();

  // Mini Anchor state machine
  public anchorState: "stowed" | "dropping" | "anchored" | "hauling" = "stowed";
  public anchorDropProgress = 0.0; // 0.0 = stowed at bow gunwale, 1.0 = fully deployed in water
  private anchorAnimTimer = 0.0;
  private anchorSplashed = false;
  private anchorSpeedFactor = 1.0;
  private onAnchorSplash?: (pos: Vec2) => void;

  public constructor() {
    // 0. Stylized V-shaped Kelvin Wake Ribbons & Foam
    this.group.add(this.wakeTrail.mesh);

    // 1. Boat Offscreen Pixel Canvas
    const boatCanvasObj = createOffscreenCanvas(SPRITE_PX_WIDTH, SPRITE_PX_HEIGHT);
    this.canvas = boatCanvasObj.canvas;
    this.ctx = boatCanvasObj.ctx;

    // Three.js Texture with NearestFilter for authentic razor-sharp pixel art
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;

    const geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.group.add(this.mesh);

    // Contact Shadow Plane (samples boat texture alpha silhouette to eliminate rectangular box)
    const shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: 0x06141a,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.shadowMesh = new THREE.Mesh(shadowGeometry, this.shadowMaterial);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.renderOrder = 5;
    this.shadowGroup.add(this.shadowMesh);

    // 2. Music Notes Texture Atlas (Pixel Art glyphs for ♪ and ♫)
    const notesCanvasObj = createOffscreenCanvas(24, 12);
    this.notesCanvas = notesCanvasObj.canvas;
    this.drawNotesAtlas(notesCanvasObj.ctx);
    this.notesTexture = new THREE.CanvasTexture(this.notesCanvas);
    this.notesTexture.magFilter = THREE.NearestFilter;
    this.notesTexture.minFilter = THREE.NearestFilter;
    this.notesTexture.generateMipmaps = false;

    // Notes quads geometry (6 vertices per quad)
    const noteVertCapacity = MAX_NOTES * 6;
    this.notePositions = new Float32Array(noteVertCapacity * 3);
    this.noteUvs = new Float32Array(noteVertCapacity * 2);
    this.noteColors = new Float32Array(noteVertCapacity * 4); // RGBA for alpha fade
    this.noteGeometry = new THREE.BufferGeometry();
    this.notePosAttr = new THREE.BufferAttribute(this.notePositions, 3);
    this.noteUvAttr = new THREE.BufferAttribute(this.noteUvs, 2);
    this.noteColAttr = new THREE.BufferAttribute(this.noteColors, 4);
    this.notePosAttr.setUsage(THREE.DynamicDrawUsage);
    this.noteUvAttr.setUsage(THREE.DynamicDrawUsage);
    this.noteColAttr.setUsage(THREE.DynamicDrawUsage);
    this.noteGeometry.setAttribute("position", this.notePosAttr);
    this.noteGeometry.setAttribute("uv", this.noteUvAttr);
    this.noteGeometry.setAttribute("color", this.noteColAttr);

    const noteMaterial = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.notesTexture } },
      vertexShader: /* glsl */ `
        attribute vec4 color;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vUv = uv;
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          gl_FragColor = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.noteMesh = new THREE.Mesh(this.noteGeometry, noteMaterial);
    this.noteMesh.frustumCulled = false;
    this.noteMesh.renderOrder = 25;
    this.group.add(this.noteMesh);

    // 3. Food Pellets Quads (6 vertices per pellet quad)
    const pelletVertCapacity = MAX_PELLETS * 6;
    this.pelletPositions = new Float32Array(pelletVertCapacity * 3);
    this.pelletColors = new Float32Array(pelletVertCapacity * 3);
    this.pelletGeometry = new THREE.BufferGeometry();
    this.pelletPosAttr = new THREE.BufferAttribute(this.pelletPositions, 3);
    this.pelletColAttr = new THREE.BufferAttribute(this.pelletColors, 3);
    this.pelletPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.pelletColAttr.setUsage(THREE.DynamicDrawUsage);
    this.pelletGeometry.setAttribute("position", this.pelletPosAttr);
    this.pelletGeometry.setAttribute("color", this.pelletColAttr);

    const pelletMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.pelletMesh = new THREE.Mesh(this.pelletGeometry, pelletMaterial);
    this.pelletMesh.frustumCulled = false;
    this.pelletMesh.renderOrder = 22;
    this.group.add(this.pelletMesh);

    // 4. Pellet Shadows
    this.pelletShadowPositions = new Float32Array(pelletVertCapacity * 3);
    this.pelletShadowColors = new Float32Array(pelletVertCapacity * 3);
    this.pelletShadowGeometry = new THREE.BufferGeometry();
    this.pelletShadowPosAttr = new THREE.BufferAttribute(this.pelletShadowPositions, 3);
    this.pelletShadowColAttr = new THREE.BufferAttribute(this.pelletShadowColors, 3);
    this.pelletShadowPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.pelletShadowColAttr.setUsage(THREE.DynamicDrawUsage);
    this.pelletShadowGeometry.setAttribute("position", this.pelletShadowPosAttr);
    this.pelletShadowGeometry.setAttribute("color", this.pelletShadowColAttr);

    const pelletShadowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.pelletShadowMesh = new THREE.Mesh(this.pelletShadowGeometry, pelletShadowMaterial);
    this.pelletShadowMesh.frustumCulled = false;
    this.pelletShadowMesh.renderOrder = 6;
    this.shadowGroup.add(this.pelletShadowMesh);

    this.updatePositionFromPreset(this.options.positionPreset);
    this.redrawSprite();
    this.updateTransforms(0);
  }

  public setScale(scale: number): void {
    this.options.scale = clamp(scale, 0, 2.0);
    const visible = this.options.scale > 0.001;
    this.group.visible = visible;
    this.shadowGroup.visible = visible;
    this.updateTransforms(0);
  }

  public setSpeedMultiplier(mult: number): void {
    this.speedMultiplier = clamp(mult, 0, 3.0);
  }

  public getSpeedMultiplier(): number {
    return this.speedMultiplier;
  }

  public setMusicPlaying(playing: boolean): void {
    if (this.isMusicPlaying !== playing) {
      this.isMusicPlaying = playing;
      this.redrawSprite();
    }
  }

  public getMusicPlaying(): boolean {
    return this.isMusicPlaying;
  }

  public isAnyMusicPlaying(): boolean {
    return this.isMusicPlaying || this.isSystemAudioPlaying || this.isMediaSessionPlaying;
  }

  public setSystemAudioPlaying(isPlaying: boolean, energy = 0): void {
    const wasPlaying = this.isAnyMusicPlaying();
    this.isSystemAudioPlaying = isPlaying;
    this.audioEnergy = energy;
    if (wasPlaying !== this.isAnyMusicPlaying()) {
      this.redrawSprite();
    }
  }

  public setMediaSessionPlaying(isPlaying: boolean): void {
    const wasPlaying = this.isAnyMusicPlaying();
    this.isMediaSessionPlaying = isPlaying;
    if (wasPlaying !== this.isAnyMusicPlaying()) {
      this.redrawSprite();
    }
  }

  public setTrackMetadata(title: string, artist?: string): void {
    this.currentTrackName = artist ? `${title} - ${artist}` : title;
  }

  public getTrackName(): string {
    return this.currentTrackName;
  }

  public triggerButtonFeedback(_btn?: "prev" | "play" | "next"): void {
    this.buttonPressTimer = 0.16;
    this.redrawSprite();
  }

  public setPositionPreset(preset: BoatPositionPreset): void {
    this.options.positionPreset = preset;
    this.updatePositionFromPreset(preset);
  }

  public updatePositionFromPreset(preset: BoatPositionPreset): void {
    switch (preset) {
      case "right":
        this.options.position = vec(CANVAS_WIDTH * 0.74, CANVAS_HEIGHT * 0.54);
        break;
      case "left":
        this.options.position = vec(CANVAS_WIDTH * 0.25, CANVAS_HEIGHT * 0.50);
        break;
      case "top-right":
        this.options.position = vec(CANVAS_WIDTH * 0.75, CANVAS_HEIGHT * 0.28);
        break;
      case "bottom-center":
        this.options.position = vec(CANVAS_WIDTH * 0.50, CANVAS_HEIGHT * 0.78);
        break;
    }
  }

  public resize(widthScale: number, heightScale: number): void {
    this.options.position.x *= widthScale;
    this.options.position.y *= heightScale;
    this.updateTransforms(0);
  }

  /**
   * Determine whether a pointer click/touch falls within the boat,
   * distinguishing between Left Compartment (Music) and Right Compartment (Food).
   */
  public startDrag(pointerPos: Vec2): void {
    if (this.anchorState !== "stowed") {
      this.haulAnchorInstant();
    }
    this.state = "dragging";
    this.options.position = { ...pointerPos };
  }

  public updateDrag(pointerPos: Vec2, onWake?: (pos: Vec2) => void): void {
    if (this.state !== "dragging") return;
    const dx = pointerPos.x - this.options.position.x;
    if (Math.abs(dx) > 0.4) {
      this.facingLeft = dx < 0;
    }
    this.options.position = { ...pointerPos };
    this.wakeTimer += 0.016;
    if (this.wakeTimer >= 0.28) {
      this.wakeTimer = 0;
      onWake?.(pointerPos);
    }
  }

  public endDrag(onSplash?: (pos: Vec2) => void): void {
    if (this.state !== "dragging") return;
    this.state = "returning";
    onSplash?.(this.options.position);
  }

  /**
   * Whether the boat is currently stationary with its anchor dropped.
   */
  public isAnchored(): boolean {
    return this.state === "anchored" || this.anchorState === "anchored";
  }

  /**
   * Toggles the mini anchor: drops if cruising (smooth deceleration to stop),
   * or hauls up if anchored (resumes orbital cruising).
   */
  public toggleAnchor(onSplash?: (pos: Vec2) => void): boolean {
    if (this.anchorState === "stowed") {
      this.dropAnchor(onSplash);
      return true;
    } else {
      this.haulAnchor();
      return false;
    }
  }

  /**
   * Deploys the mini anchor into the pond water, smoothly decelerating the boat to a full stop.
   */
  public dropAnchor(onSplash?: (pos: Vec2) => void): void {
    if (this.anchorState === "dropping" || this.anchorState === "anchored") return;
    this.anchorState = "dropping";
    this.anchorAnimTimer = 0;
    this.anchorSplashed = false;
    this.onAnchorSplash = onSplash;
    this.redrawSprite();
  }

  /**
   * Hauls the mini anchor back up to the bow gunwale, allowing the boat to resume its orbital cruising.
   */
  public haulAnchor(): void {
    if (this.anchorState === "hauling" || this.anchorState === "stowed") return;
    this.anchorState = "hauling";
    this.anchorAnimTimer = 0;
    this.redrawSprite();
  }

  /**
   * Instantly stows the anchor (e.g. when dragged by the user).
   */
  public haulAnchorInstant(): void {
    this.anchorState = "stowed";
    this.anchorDropProgress = 0.0;
    this.anchorAnimTimer = 0;
    this.anchorSpeedFactor = 1.0;
    if (this.state === "anchored") {
      this.state = "orbiting";
    }
    this.redrawSprite();
  }

  /**
   * Determine whether a pointer click/touch falls within the boat,
   * distinguishing between Mini Anchor (Bow), Gramophone (Mid-Deck), and Food Feeder (Stern).
   */
  public hitTest(point: Vec2): BoatInteractionZone {
    if (this.options.scale <= 0.001 || !this.group.visible) return null;

    const boatW = BOAT_BASE_WIDTH * this.options.scale;
    const boatH = BOAT_BASE_HEIGHT * this.options.scale;
    const center = add(this.options.position, vec(0, this.bobY));

    const dx = point.x - center.x;
    const dy = point.y - center.y;

    // Rotate point inversely by current boat pitch angle for accurate local-space alignment
    const cosA = Math.cos(-this.pitchAngle);
    const sinA = Math.sin(-this.pitchAngle);
    const localX = dx * cosA - dy * sinA;
    const localY = dx * sinA + dy * cosA;

    const halfW = boatW * 0.5;
    const halfH = boatH * 0.5;

    // Generous bounding check with tactile padding for reliable dragging and clicking
    if (Math.abs(localY) > halfH * 1.5 || Math.abs(localX) > halfW * 1.4) {
      return null;
    }

    const flipX = this.facingLeft ? 1 : -1;
    const orientedLocalX = localX * flipX;

    // Bow Prow & Mini Anchor Zone (outer front prow of the boat):
    // Also hit-tests the submerged anchor dangling in the water when deployed
    const isAnchorDeployedZone =
      this.anchorDropProgress > 0 &&
      orientedLocalX < -BOAT_BASE_WIDTH * 0.15 &&
      localY > 0;
    if (orientedLocalX < -BOAT_BASE_WIDTH * 0.30 || isAnchorDeployedZone) {
      return "anchor";
    }

    // Right Compartment: Fish Food Feeder Tray (stern side)
    if (orientedLocalX >= 0) {
      return "food";
    }

    // Left Compartment: Vintage Gramophone Music Player (mid-deck bow side)
    return "music";
  }

  /**
   * Spawns pixel food pellets dropping from the boat into the pond water,
   * triggering water ripples and calling koi to feed.
   */
  public dropFoodPellets(
    targetWaterPos: Vec2,
    onWaterSplash?: (pos: Vec2) => void,
  ): void {
    this.foodRecoilTimer = 0.25; // Trigger tactile squish recoil on food tray

    const boatCenter = add(this.options.position, vec(0, this.bobY));
    const foodOrigin = add(boatCenter, vec(BOAT_BASE_WIDTH * 0.25 * this.options.scale, 0));

    // Spawn 3-5 pellets with parabolic trajectory arcs
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      if (this.pellets.length >= MAX_PELLETS) this.pellets.shift();

      const targetX = targetWaterPos.x + (Math.random() - 0.5) * 16;
      const targetY = targetWaterPos.y + (Math.random() - 0.5) * 16;

      const flightDuration = 0.40 + Math.random() * 0.25;
      const vx = (targetX - foodOrigin.x) / flightDuration;
      const vy = (targetY - foodOrigin.y) / flightDuration;
      const vz = 18 + Math.random() * 12; // Initial vertical upward arc

      this.pellets.push({
        x: foodOrigin.x,
        y: foodOrigin.y,
        vx,
        vy,
        z: 4.0, // Start slightly above boat rim
        vz,
        state: "air",
        age: 0,
        maxAge: 60.0 + Math.random() * 10.0,
        colorIdx: Math.floor(Math.random() * PELLET_PALETTE.length),
      });
    }

    // Callback on splash point
    if (onWaterSplash) {
      setTimeout(() => {
        onWaterSplash(targetWaterPos);
      }, 400);
    }
  }

  /**
   * Main per-frame update loop:
   * 1. Physical water bobbing & harmonic pitching
   * 2. Wave response to swimming koi ripples
   * 3. Music note particle emission & drifting
   * 4. Food pellet physics & water splashes
   */
  public update(
    time: number,
    ripples?: RippleSystem | null,
    weatherId: WeatherPresetId = "sunny",
    onWaterSplash?: (pos: Vec2) => void,
    _clockPosition?: Vec2 | null,
    onWake?: (pos: Vec2) => void,
    school?: School | readonly Koi[] | null,
  ): void {
    if (this.options.scale <= 0.001 || !this.group.visible) {
      this.noteGeometry.setDrawRange(0, 0);
      this.pelletGeometry.setDrawRange(0, 0);
      this.pelletShadowGeometry.setDrawRange(0, 0);
      this.wakeTrail.clear();
      return;
    }

    const dt = 0.016;

    // Extract active koi list for proximity feeding interaction
    const activeKoi: Koi[] = [];
    if (school) {
      if (Array.isArray(school)) {
        activeKoi.push(...(school as Koi[]));
      } else if (typeof (school as any).activeIndices === "function" && Array.isArray((school as any).fish)) {
        const indices = (school as School).activeIndices();
        for (const idx of indices) {
          const f = (school as School).fish[idx];
          if (f) activeKoi.push(f);
        }
      } else if (Array.isArray((school as any).fish)) {
        activeKoi.push(...(school as any).fish);
      }
    }

    // 1. Maintain locked orbit center at pond center (CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.48)
    this.orbitCenter.x = CANVAS_WIDTH * 0.5;
    this.orbitCenter.y = CANVAS_HEIGHT * 0.48;

    // Anchor Animation & Deceleration Physics
    if (this.anchorState === "dropping") {
      this.anchorAnimTimer += dt;
      const dropDuration = 0.95;
      const progress = Math.min(1.0, this.anchorAnimTimer / dropDuration);
      // Gravity drop: accelerates downwards
      this.anchorDropProgress = Math.pow(progress, 1.5);
      // Smooth quadratic deceleration ease-out to complete stop
      this.anchorSpeedFactor = Math.pow(Math.max(0, 1.0 - progress), 2.0);

      // Water splash ripple when anchor penetrates water surface (~70% drop)
      if (progress >= 0.70 && !this.anchorSplashed) {
        this.anchorSplashed = true;
        const flipX = this.facingLeft ? 1 : -1;
        const anchorOffset = vec(-BOAT_BASE_WIDTH * 0.38 * this.options.scale * flipX, 9.6 * this.options.scale);
        const splashPos = add(this.options.position, anchorOffset);
        this.onAnchorSplash?.(splashPos);
        onWake?.(splashPos);
      }

      if (progress >= 1.0) {
        this.anchorState = "anchored";
        this.state = "anchored";
        this.anchorSpeedFactor = 0.0;
        this.anchorDropProgress = 1.0;
      }
      this.redrawSprite();
    } else if (this.anchorState === "hauling") {
      this.anchorAnimTimer += dt;
      const haulDuration = 0.75;
      const progress = Math.min(1.0, this.anchorAnimTimer / haulDuration);
      // Steady winch cranking
      this.anchorDropProgress = Math.max(0, 1.0 - progress);
      this.anchorSpeedFactor = 0.0;

      if (progress >= 1.0) {
        this.anchorState = "stowed";
        this.anchorDropProgress = 0.0;
        this.state = "orbiting";
        this.anchorSpeedFactor = 1.0;
      }
      this.redrawSprite();
    }

    // 2. Navigation State Machine: Orbiting vs Returning vs Dragging vs Anchored
    const prevPosition = vec(this.options.position.x, this.options.position.y);

    if (this.state === "orbiting") {
      const currentOrbitSpeed = this.orbitSpeed * this.speedMultiplier * this.anchorSpeedFactor;
      this.orbitAngle = (this.orbitAngle + currentOrbitSpeed * dt) % (Math.PI * 2);
      this.options.position = vec(
        this.orbitCenter.x + this.orbitRadiusX * Math.cos(this.orbitAngle),
        this.orbitCenter.y + this.orbitRadiusY * Math.sin(this.orbitAngle),
      );

      // Tangential velocity vector: d/d theta [Rx cos theta, Ry sin theta] = [-Rx sin theta, Ry cos theta]
      const vxTan = -this.orbitRadiusX * Math.sin(this.orbitAngle) * this.speedMultiplier * this.anchorSpeedFactor;
      if (Math.abs(vxTan) > 0.005) {
        this.facingLeft = vxTan < 0;
      }

      // Gentle stern wake ripple (calm mouth ripples, no fish call)
      if (this.speedMultiplier * this.anchorSpeedFactor > 0.05) {
        this.wakeTimer += dt * this.speedMultiplier * this.anchorSpeedFactor;
        if (this.wakeTimer >= 0.85) {
          this.wakeTimer = 0;
          const sternOffsetX = (this.facingLeft ? 1 : -1) * BOAT_BASE_WIDTH * 0.32 * this.options.scale;
          const sternPos = add(this.options.position, vec(sternOffsetX, 3));
          onWake?.(sternPos);
        }
      }
    } else if (this.state === "anchored") {
      // Stationary when anchored: position is held firm, gentle harmonic water bobbing continues
      this.wakeTimer = 0;
    } else if (this.state === "returning") {
      // Find closest rendezvous angle on the orbital ellipse
      const dx = (this.options.position.x - this.orbitCenter.x) / this.orbitRadiusX;
      const dy = (this.options.position.y - this.orbitCenter.y) / this.orbitRadiusY;
      const targetTheta = Math.atan2(dy, dx);
      const rendezvousPoint = vec(
        this.orbitCenter.x + this.orbitRadiusX * Math.cos(targetTheta),
        this.orbitCenter.y + this.orbitRadiusY * Math.sin(targetTheta),
      );

      const delta = sub(rendezvousPoint, this.options.position);
      const dist = length(delta);

      if (dist <= 4.0) {
        this.options.position = rendezvousPoint;
        this.orbitAngle = targetTheta;
        this.state = "orbiting";
        onWake?.(this.options.position);
      } else {
        const dir = normalize(delta);
        const effectiveReturnSpeed = this.returnSpeed * Math.max(0.6, this.speedMultiplier);
        this.options.position = add(this.options.position, mul(dir, effectiveReturnSpeed * dt));
        this.facingLeft = dir.x < 0;

        this.wakeTimer += dt;
        if (this.wakeTimer >= 0.45) {
          this.wakeTimer = 0;
          onWake?.(this.options.position);
        }
      }
    }

    // Calculate instantaneous planar velocity
    const boatVelocity = vec(
      (this.options.position.x - prevPosition.x) / dt,
      (this.options.position.y - prevPosition.y) / dt,
    );

    // Swap bowOffset and sternOffset so the wake trail and bow splash swap sides accurately:
    // When moving left, bow (splash) is on the left (-X), stern (trail) is on the right (+X)
    // When moving right, bow (splash) is on the right (+X), stern (trail) is on the left (-X)
    const flipX = this.facingLeft ? 1 : -1;
    const sternOffset = vec(
      BOAT_BASE_WIDTH * 0.40 * this.options.scale * flipX,
      9.6 * this.options.scale,
    );
    const bowOffset = vec(
      -BOAT_BASE_WIDTH * 0.40 * this.options.scale * flipX,
      9.6 * this.options.scale,
    );
    const bowPos = add(this.options.position, bowOffset);
    const sternPos = add(this.options.position, sternOffset);

    // Update V-shaped Kelvin Wake Ribbons, bow spray, and stern bubbles
    this.wakeTrail.update(
      dt,
      this.options.position,
      bowPos,
      sternPos,
      boatVelocity,
      this.options.scale,
      weatherId,
    );

    // 3. Natural hydrodynamics: harmonic buoyancy bobbing & rocking pitch
    // m d²h/dt² + c dh/dt + k h = F_wave
    const ambientBob =
      Math.sin(time * 1.85) * 1.15 +
      Math.sin(time * 3.10 + 0.8) * 0.45;
    const ambientPitch =
      Math.sin(time * 1.45 + 0.4) * 0.035 +
      Math.sin(time * 2.65 + 1.2) * 0.015;

    // 4. Interactive wave displacement from passing koi ripples
    let rippleDisplacement = 0;
    let ripplePitchTorque = 0;
    if (ripples && ripples.instances) {
      const center = this.options.position;
      for (const rip of ripples.instances) {
        if (!rip || rip.age > 2.8) continue;
        const dx = center.x - rip.center.x;
        const dy = center.y - rip.center.y;
        const dist = Math.hypot(dx, dy);
        const waveRadius = 12.0 + rip.age * 88.0;
        const distDiff = Math.abs(dist - waveRadius);

        if (distDiff < 20.0) {
          const wavePhase = (dist - waveRadius) / 6.0;
          const waveAmp =
            Math.exp(-distDiff * 0.15) *
            clamp(1.0 - rip.age / 2.8, 0, 1) *
            rip.strength *
            0.85;
          rippleDisplacement += Math.cos(wavePhase * Math.PI) * waveAmp;
          ripplePitchTorque += Math.sin(wavePhase * Math.PI) * (dx / Math.max(dist, 1.0)) * waveAmp * 0.025;
        }
      }
    }

    this.targetY = ambientBob + rippleDisplacement;
    this.targetAngle = ambientPitch + ripplePitchTorque;

    // Smooth second-order critically damped interpolation
    this.currentY += (this.targetY - this.currentY) * 0.12;
    this.currentAngle += (this.targetAngle - this.currentAngle) * 0.10;

    this.bobY = this.currentY;
    this.pitchAngle = this.currentAngle;

    // 3. Tactile recoil timers
    if (this.foodRecoilTimer > 0) {
      this.foodRecoilTimer = Math.max(0, this.foodRecoilTimer - dt);
    }
    if (this.buttonPressTimer > 0) {
      this.buttonPressTimer = Math.max(0, this.buttonPressTimer - dt);
      if (this.buttonPressTimer === 0) {
        this.redrawSprite();
      }
    }

    // 4. Vinyl turntable spinning animation (when in-app music or system audio is playing)
    const isPlaying = this.isAnyMusicPlaying();
    if (isPlaying) {
      // Vinyl spin speed accelerates dynamically with audio beat energy
      const frameInterval = Math.max(0.08, 0.20 - this.audioEnergy * 0.16);
      if (time - this.lastVinylFrameTime > frameInterval) {
        this.vinylRotationFrame = (this.vinylRotationFrame + 1) % 4;
        this.lastVinylFrameTime = time;
        this.redrawSprite();
      }

      // Spawn music note particles (tempo adjusted by audio energy)
      const noteSpawnInterval = Math.max(0.45, 0.85 - this.audioEnergy * 0.45);
      if (time - this.lastNoteSpawnTime > noteSpawnInterval) {
        this.lastNoteSpawnTime = time;
        const boatCenter = add(this.options.position, vec(0, this.bobY));
        const flipX = this.facingLeft ? 1 : -1;
        const hornX = boatCenter.x - BOAT_BASE_WIDTH * 0.28 * this.options.scale * flipX;
        const hornY = boatCenter.y - BOAT_BASE_HEIGHT * 0.20 * this.options.scale;

        if (this.notes.length >= MAX_NOTES) this.notes.shift();

        this.notes.push({
          x: hornX + (Math.random() - 0.5) * 2.5,
          y: hornY,
          vx: (-1.8 - Math.random() * 3.2) * flipX, // Drift outward
          vy: -10.0 - Math.random() * 6.0,          // Rise up into the air
          age: 0,
          maxAge: 2.8 + Math.random() * 0.8,
          type: Math.random() < 0.5 ? 0 : 1,
          size: (4.5 + Math.random() * 2.0) * this.options.scale,
          driftPhase: Math.random() * Math.PI * 2,
        });
      }
    }

    // 5. Update music notes particles
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const note = this.notes[i];
      note.age += dt;
      if (note.age >= note.maxAge) {
        this.notes.splice(i, 1);
        continue;
      }
      note.x += note.vx * dt + Math.sin(note.age * 4.2 + note.driftPhase) * 0.25;
      note.y += note.vy * dt;
    }

    // 6. Update food pellet particles with proximity koi feeding
    let floatingPelletCount = 0;
    let sumPelletX = 0;
    let sumPelletY = 0;

    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const pellet = this.pellets[i];
      pellet.age += dt;

      if (pellet.state === "air") {
        pellet.x += pellet.vx * dt;
        pellet.y += pellet.vy * dt;
        pellet.z += pellet.vz * dt;
        pellet.vz -= 68.0 * dt; // Gravity

        // Impact with water surface
        if (pellet.z <= 0) {
          pellet.z = 0;
          pellet.state = "floating";
          pellet.vx *= 0.15;
          pellet.vy *= 0.15;
          if (onWaterSplash) {
            onWaterSplash(vec(pellet.x, pellet.y));
          }
        }
      } else if (pellet.state === "floating") {
        floatingPelletCount++;
        sumPelletX += pellet.x;
        sumPelletY += pellet.y;

        // Pellets bob lightly on water surface with subtle current drift
        pellet.x += Math.sin(time * 2.0 + pellet.age) * 0.08 * (dt * 60);
        pellet.y += Math.cos(time * 1.8 + pellet.age) * 0.06 * (dt * 60);

        // Proximity feeding check: pellet is only consumed when a koi swims close to bite
        let eaten = false;
        if (activeKoi.length > 0) {
          for (const fish of activeKoi) {
            // Fish swimming deep beneath surface (> 0.48) cannot bite surface food
            if (fish.depth > 0.48) continue;

            const mouthOffset = (fish.bodyWidth ?? 12.0) * 0.65;
            const mouthX = fish.position.x + Math.cos(fish.heading) * mouthOffset;
            const mouthY = fish.position.y + Math.sin(fish.heading) * mouthOffset;

            const distMouth = Math.hypot(pellet.x - mouthX, pellet.y - mouthY);
            const distHead = Math.hypot(pellet.x - fish.position.x, pellet.y - fish.position.y);
            const eatRadius = Math.max(8.0, (fish.bodyWidth ?? 12.0) * 1.15);

            // Subtle hydrodynamic suction into koi's mouth when very close
            if (distMouth < eatRadius * 1.8 && distMouth > 0.1) {
              const suctionSpeed = 16.0 * dt;
              pellet.x += ((mouthX - pellet.x) / distMouth) * suctionSpeed;
              pellet.y += ((mouthY - pellet.y) / distMouth) * suctionSpeed;
            }

            // Proximity bite condition: pellet reached mouth or tip of snout
            if (distMouth <= eatRadius || distHead <= eatRadius * 0.88) {
              eaten = true;
              fish.gulpAnimation = FISH.feeding?.animationDurationSeconds ?? 0.35;
              fish.gulpCountdown = 1.6;
              ripples?.trigger("mouth", vec(pellet.x, pellet.y));
              break;
            }
          }
        }

        if (eaten) {
          this.pellets.splice(i, 1);
          continue;
        }

        // Failsafe: only start sinking after remaining un-eaten for a prolonged time (45 seconds)
        if (pellet.age > 45.0) {
          pellet.state = "sinking";
        }
      } else if (pellet.state === "sinking") {
        // Slowly sinking out of sight after prolonged timeout
        pellet.z -= 0.6 * dt;
        if (pellet.age >= pellet.maxAge || pellet.z < -4.0) {
          this.pellets.splice(i, 1);
          continue;
        }
      }
    }

    // Gentle call nudge: if floating pellets remain un-eaten, gently guide koi towards pellet cluster center
    if (floatingPelletCount > 0 && school && typeof (school as School).callTo === "function") {
      this.foodCallNudgeTimer += dt;
      if (this.foodCallNudgeTimer >= 2.5) {
        this.foodCallNudgeTimer = 0;
        const centerPos = vec(sumPelletX / floatingPelletCount, sumPelletY / floatingPelletCount);
        (school as School).callTo(centerPos);
      }
    } else {
      this.foodCallNudgeTimer = 0;
    }

    // Notify school of food pellets status for 5s post-feeding dispersal
    if (school && typeof (school as School).notifyFoodStatus === "function") {
      const centerPos = floatingPelletCount > 0
        ? vec(sumPelletX / floatingPelletCount, sumPelletY / floatingPelletCount)
        : undefined;
      (school as School).notifyFoodStatus(floatingPelletCount, centerPos);
    }

    // 7. Update weather tint and shadows
    const tint = WEATHER_TINTS[weatherId] ?? WEATHER_TINTS.sunny;
    this.material.color.copy(tint);

    const shadowInfo = WEATHER_SHADOW_OFFSETS[weatherId] ?? WEATHER_SHADOW_OFFSETS.sunny;
    this.shadowMaterial.opacity = shadowInfo.opacity;

    // 8. Commit Particle Meshes
    this.commitParticleMeshes(shadowInfo);

    // 9. Update Three.js Object Transforms
    this.updateTransforms(time, shadowInfo);
  }

  /**
   * Commit dynamic particles (floating musical notes & food pellets) to GPU buffers.
   */
  private commitParticleMeshes(shadowInfo: { x: number; y: number; opacity: number }): void {
    // 1. Commit Notes Quads
    let noteVertCursor = 0;
    for (const note of this.notes) {
      const uMin = note.type === 0 ? 0.0 : 0.5;
      const uMax = note.type === 0 ? 0.5 : 1.0;
      const halfSize = note.size * 0.5;
      const left = note.x - halfSize;
      const right = note.x + halfSize;
      const top = note.y - halfSize;
      const bottom = note.y + halfSize;

      // Alpha fade curve: quick fade-in, smooth fade-out
      const lifeT = note.age / note.maxAge;
      const alpha = Math.sin(lifeT * Math.PI) * 0.95;

      const v = [
        left, top, 0.08,  uMin, 1.0, 1.0, 0.85, 0.25, alpha,
        right, top, 0.08, uMax, 1.0, 1.0, 0.85, 0.25, alpha,
        right, bottom, 0.08, uMax, 0.0, 1.0, 0.85, 0.25, alpha,

        left, top, 0.08,  uMin, 1.0, 1.0, 0.85, 0.25, alpha,
        right, bottom, 0.08, uMax, 0.0, 1.0, 0.85, 0.25, alpha,
        left, bottom, 0.08, uMin, 0.0, 1.0, 0.85, 0.25, alpha,
      ];

      for (let i = 0; i < 6; i++) {
        const offset = i * 9;
        const pIdx = (noteVertCursor + i) * 3;
        const uIdx = (noteVertCursor + i) * 2;
        const cIdx = (noteVertCursor + i) * 4;

        this.notePositions[pIdx] = v[offset];
        this.notePositions[pIdx + 1] = v[offset + 1];
        this.notePositions[pIdx + 2] = v[offset + 2];

        this.noteUvs[uIdx] = v[offset + 3];
        this.noteUvs[uIdx + 1] = v[offset + 4];

        this.noteColors[cIdx] = v[offset + 5];
        this.noteColors[cIdx + 1] = v[offset + 6];
        this.noteColors[cIdx + 2] = v[offset + 7];
        this.noteColors[cIdx + 3] = v[offset + 8];
      }
      noteVertCursor += 6;
    }
    this.noteGeometry.setDrawRange(0, noteVertCursor);
    this.notePosAttr.needsUpdate = true;
    this.noteUvAttr.needsUpdate = true;
    this.noteColAttr.needsUpdate = true;

    // 2. Commit Food Pellets Quads & Shadows
    let pelletVertCursor = 0;
    const pelletRadius = 0.9 * this.options.scale;

    for (const pellet of this.pellets) {
      const color = PELLET_PALETTE[pellet.colorIdx % PELLET_PALETTE.length];
      const px = pellet.x;
      const py = pellet.y - pellet.z; // In-air elevation shifts visually up
      const r = pelletRadius * (pellet.state === "air" ? 1.25 : 1.0);

      // Pellet Body (quad in surfaceObjectScene)
      const corners = [
        px - r, py - r, 0.06,
        px + r, py - r, 0.06,
        px + r, py + r, 0.06,

        px - r, py - r, 0.06,
        px + r, py + r, 0.06,
        px - r, py + r, 0.06,
      ];

      // Pellet Shadow (quad on water surface)
      const sx = pellet.x + shadowInfo.x * 0.4;
      const sy = pellet.y + shadowInfo.y * 0.4;
      const sr = r * clamp(1.0 - pellet.z * 0.04, 0.5, 1.0);
      const shadowCorners = [
        sx - sr, sy - sr, 0.02,
        sx + sr, sy - sr, 0.02,
        sx + sr, sy + sr, 0.02,

        sx - sr, sy - sr, 0.02,
        sx + sr, sy + sr, 0.02,
        sx - sr, sy + sr, 0.02,
      ];

      for (let i = 0; i < 6; i++) {
        const cOffset = i * 3;
        const pIdx = (pelletVertCursor + i) * 3;

        this.pelletPositions[pIdx] = corners[cOffset];
        this.pelletPositions[pIdx + 1] = corners[cOffset + 1];
        this.pelletPositions[pIdx + 2] = corners[cOffset + 2];

        this.pelletColors[pIdx] = color.r;
        this.pelletColors[pIdx + 1] = color.g;
        this.pelletColors[pIdx + 2] = color.b;

        this.pelletShadowPositions[pIdx] = shadowCorners[cOffset];
        this.pelletShadowPositions[pIdx + 1] = shadowCorners[cOffset + 1];
        this.pelletShadowPositions[pIdx + 2] = shadowCorners[cOffset + 2];

        this.pelletShadowColors[pIdx] = 0.05;
        this.pelletShadowColors[pIdx + 1] = 0.08;
        this.pelletShadowColors[pIdx + 2] = 0.10;
      }
      pelletVertCursor += 6;
    }

    this.pelletGeometry.setDrawRange(0, pelletVertCursor);
    this.pelletPosAttr.needsUpdate = true;
    this.pelletColAttr.needsUpdate = true;

    this.pelletShadowGeometry.setDrawRange(0, pelletVertCursor);
    this.pelletShadowPosAttr.needsUpdate = true;
    this.pelletShadowColAttr.needsUpdate = true;
  }

  /**
   * Draw the pixel art texture atlas for musical notes ♪ and ♫.
   */
  private drawNotesAtlas(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, 24, 12);

    const px = (x: number, y: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    };

    const C_GOLD = "#ffd43b";
    const C_DARK = "#78350f";

    // Glyph 0: Single Note ♪ (in [0..11, 0..11])
    // Outline / shadow
    px(2, 7, C_DARK); px(3, 7, C_DARK); px(4, 7, C_DARK);
    px(1, 8, C_DARK); px(5, 8, C_DARK);
    px(1, 9, C_DARK); px(5, 9, C_DARK);
    px(2, 10, C_DARK); px(3, 10, C_DARK); px(4, 10, C_DARK);
    px(5, 2, C_DARK); px(6, 2, C_DARK); px(7, 3, C_DARK); px(8, 4, C_DARK);

    // Note head & stem
    px(2, 8, C_GOLD); px(3, 8, C_GOLD); px(4, 8, C_GOLD);
    px(2, 9, C_GOLD); px(3, 9, C_GOLD); px(4, 9, C_GOLD);
    px(4, 3, C_GOLD); px(4, 4, C_GOLD); px(4, 5, C_GOLD); px(4, 6, C_GOLD); px(4, 7, C_GOLD);
    px(5, 3, C_GOLD); px(6, 3, C_GOLD); px(7, 4, C_GOLD);

    // Glyph 1: Beamed Note ♫ (in [12..23, 0..11])
    // Left Note Head
    px(13, 8, C_GOLD); px(14, 8, C_GOLD); px(15, 8, C_GOLD);
    px(13, 9, C_GOLD); px(14, 9, C_GOLD); px(15, 9, C_GOLD);
    // Right Note Head
    px(19, 7, C_GOLD); px(20, 7, C_GOLD); px(21, 7, C_GOLD);
    px(19, 8, C_GOLD); px(20, 8, C_GOLD); px(21, 8, C_GOLD);
    // Stems & Beam
    px(15, 3, C_GOLD); px(15, 4, C_GOLD); px(15, 5, C_GOLD); px(15, 6, C_GOLD); px(15, 7, C_GOLD);
    px(21, 2, C_GOLD); px(21, 3, C_GOLD); px(21, 4, C_GOLD); px(21, 5, C_GOLD); px(21, 6, C_GOLD);
    px(15, 2, C_GOLD); px(16, 2, C_GOLD); px(17, 2, C_GOLD); px(18, 2, C_GOLD); px(19, 2, C_GOLD); px(20, 2, C_GOLD);
  }

  /**
   * Redraw the offscreen Canvas with authentic Pixel Art matching the user's reference image:
   * - Curved wooden sampan hull with dark keel and warm cedar gunwale
   * - Left compartment: Vintage gramophone with vinyl record & brass trumpet horn
   * - Center partition: Vertical cedar beam
   * - Right compartment: Sushi & wrapped rice parcels, green garnish leaves, and golden koi pellets
   * - Waterline foam around bottom hull
   */
  private redrawSprite(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SPRITE_PX_WIDTH, SPRITE_PX_HEIGHT);

    // Helpers for crisp pixel art drawing
    const px = (x: number, y: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    };
    const rect = (x: number, y: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    };

    // --- PALETTE DEFINITION ---
    const C_OUTLINE = "#23140c";       // Deepest wood outline
    const C_DARK_WOOD = "#3d2213";     // Keel shadow planks
    const C_MID_WOOD = "#683c20";      // Rich cedar hull
    const C_LIGHT_WOOD = "#945832";    // Mid-tone hull planks
    const C_DECK_WOOD = "#b57242";     // Inner deck floor
    const C_RIM_HIGHLIGHT = "#d49666"; // Warm cedar gunwale rim
    const C_RIM_TOP = "#f0caa0";       // Bright gunwale highlight
    const C_MAST_WOOD = "#452615";

    // --- VINTAGE GRAMOPHONE & FLUTED BRASS HORN PALETTE ---
    const C_GRAMO_WOOD = "#3d1f0f";      // Rich dark walnut cabinet
    const C_GRAMO_BEVEL = "#69371a";     // Cabinet top bevel highlight
    const C_GRAMO_TRIM = "#b88e36";      // Brass corner bracket accents
    const C_VINYL = "#121212";           // Deep obsidian vinyl record
    const C_VINYL_GROOVE = "#222222";    // Concentric microgrooves
    const C_VINYL_GLINT = "#5c5c5c";     // Spinning light glint on vinyl
    const C_VINYL_LABEL = "#c92a2a";     // Red center record label
    const C_GOLD_PIN = "#fcc419";        // Center spindle pin
    const C_TONEARM_BRASS = "#caa257";   // Tone arm & reproducer needle
    const C_TONEARM_SHINE = "#fff3bf";   // Needle chrome gleam
    const C_CRANK_GOLD = "#e5a93b";      // Side winding crank

    // Fluted Brass Trumpet Horn (Kèn đồng hoa cúc vươn cao kiêu hãnh)
    const C_BRASS_DARK = "#704f05";      // Shaded brass tube & horn throat
    const C_BRASS_MID = "#b88e36";       // Warm polished brass body
    const C_BRASS_LIGHT = "#f5c427";     // Bright golden brass flare
    const C_BRASS_SHINE = "#fff194";     // Specular horn rim highlight
    const C_HORN_DEPTH = "#3d2a02";      // Deep acoustic throat interior

    // Food Compartment (Sashimi, Maki, Garnish, Pellets)
    const C_SUSHI_WHITE = "#f8f9fa";
    const C_SUSHI_PINK = "#f06595";
    const C_SUSHI_RED = "#e03131";
    const C_NORI_DARK = "#1a1e21";
    const C_LEAF_GREEN = "#37b24d";
    const C_LEAF_DARK = "#23702c";
    const C_LEAF_LIGHT = "#74b816";
    const C_PELLET_ORANGE = "#fd7e14";
    const C_PELLET_GOLD = "#ffa94d";

    // Subtle Waterline Foam
    const C_FOAM_LIGHT = "rgba(224, 242, 254, 0.40)";
    const C_FOAM_MID = "rgba(186, 230, 253, 0.25)";

    const isPlaying = this.isAnyMusicPlaying();

    // 1. Waterline Foam (subtle wake around keel)
    rect(20, 48, 40, 2, C_FOAM_MID);
    rect(24, 49, 32, 2, C_FOAM_LIGHT);

    // 2. Keel & Hull Outer Planks (Upward curves on both bow & stern)
    rect(22, 46, 36, 3, C_OUTLINE);
    rect(18, 43, 44, 3, C_DARK_WOOD);
    rect(15, 40, 50, 3, C_MID_WOOD);
    rect(13, 37, 54, 3, C_LIGHT_WOOD);
    rect(11, 34, 58, 3, C_DECK_WOOD);

    // 3. Graceful Swept Bow (Left prow curving up to Y=16)
    rect(9, 30, 5, 5, C_MID_WOOD);
    rect(7, 24, 4, 7, C_LIGHT_WOOD);
    rect(6, 19, 4, 6, C_DECK_WOOD);
    rect(5, 17, 4, 3, C_RIM_TOP);
    rect(4, 16, 1, 15, C_OUTLINE); // Bow leading edge
    rect(5, 16, 4, 1, C_OUTLINE);  // Bow top outline
    rect(5, 17, 3, 1, C_RIM_HIGHLIGHT);

    // 4. Raised Stern (Right stern curving up to vertical post at Y=13)
    rect(67, 30, 5, 5, C_LIGHT_WOOD);
    rect(70, 23, 4, 8, C_DECK_WOOD);
    rect(72, 16, 4, 8, C_RIM_HIGHLIGHT);
    rect(72, 13, 4, 4, C_RIM_TOP);
    rect(75, 13, 1, 19, C_OUTLINE); // Stern trailing edge
    rect(72, 13, 4, 1, C_OUTLINE);  // Stern top outline

    // 5. Deck Gunwale Rim (Be thuyền)
    rect(11, 33, 58, 1, C_RIM_HIGHLIGHT);
    rect(12, 32, 56, 1, C_RIM_TOP);

    // 6. Center Partition Beam (Vách ngăn khoang ở giữa thuyền)
    rect(38, 19, 3, 15, C_MAST_WOOD);
    rect(39, 19, 1, 15, C_LIGHT_WOOD);

    // 7. Left Compartment: Vintage Gramophone with Grand Fluted Brass Horn & Spinning Vinyl
    // A. Handcrafted Dark Walnut Cabinet on Deck
    rect(13, 26, 20, 6, C_GRAMO_WOOD);
    rect(13, 26, 20, 1, C_GRAMO_BEVEL);
    rect(14, 27, 18, 1, C_GRAMO_TRIM);
    // Brass corner brackets & feet
    rect(13, 31, 3, 2, C_GRAMO_TRIM);
    rect(30, 31, 3, 2, C_GRAMO_TRIM);
    // Side mechanical winding crank
    px(33, 29, C_CRANK_GOLD);
    px(34, 28, C_CRANK_GOLD);
    px(34, 27, C_CRANK_GOLD);

    // B. Turntable Platter & Spinning Obsidian Vinyl Record
    rect(15, 22, 14, 4, C_VINYL);
    rect(17, 21, 10, 6, C_VINYL);
    rect(16, 23, 12, 2, C_VINYL_GROOVE);
    rect(20, 23, 4, 2, C_VINYL_LABEL);
    px(21, 24, C_GOLD_PIN);
    px(22, 24, C_GOLD_PIN);

    // Real-time Spinning Vinyl Record Glint (Synchronized with audio tempo)
    if (isPlaying) {
      if (this.vinylRotationFrame === 0) {
        px(17, 24, C_VINYL_GLINT); px(18, 24, C_VINYL_GLINT);
        px(24, 24, C_VINYL_GLINT); px(25, 24, C_VINYL_GLINT);
      } else if (this.vinylRotationFrame === 1) {
        px(18, 23, C_VINYL_GLINT); px(19, 23, C_VINYL_GLINT);
        px(23, 25, C_VINYL_GLINT); px(24, 25, C_VINYL_GLINT);
      } else if (this.vinylRotationFrame === 2) {
        px(21, 22, C_VINYL_GLINT); px(22, 22, C_VINYL_GLINT);
        px(21, 26, C_VINYL_GLINT); px(22, 26, C_VINYL_GLINT);
      } else {
        px(23, 23, C_VINYL_GLINT); px(24, 23, C_VINYL_GLINT);
        px(18, 25, C_VINYL_GLINT); px(19, 25, C_VINYL_GLINT);
      }
    }

    // C. Brass Tonearm & Reproducer Needle
    px(28, 24, C_TONEARM_BRASS);
    px(28, 23, C_TONEARM_BRASS);
    px(27, 23, C_TONEARM_BRASS);
    px(26, 23, C_TONEARM_BRASS);
    px(25, 23, C_TONEARM_BRASS);
    px(24, 23, C_TONEARM_SHINE);
    px(23, 24, C_TONEARM_SHINE);

    // D. Grand Fluted Brass Trumpet Horn (Curved acoustic tube rising high)
    // S-curved brass support conduit
    px(26, 25, C_BRASS_DARK);
    px(26, 24, C_BRASS_MID);
    px(25, 23, C_BRASS_MID);
    px(24, 22, C_BRASS_MID);
    px(22, 21, C_BRASS_LIGHT);
    px(21, 20, C_BRASS_LIGHT);
    px(19, 19, C_BRASS_MID);

    // Horn neck expanding into majestic flared bell
    rect(17, 17, 4, 3, C_BRASS_MID);
    rect(15, 15, 4, 3, C_BRASS_LIGHT);
    rect(12, 12, 6, 5, C_BRASS_MID);
    rect(13, 11, 6, 4, C_BRASS_LIGHT);

    // Fluted brass petal bell opening facing forward-left
    rect(9, 8, 7, 7, C_BRASS_LIGHT);
    rect(8, 7, 8, 8, C_BRASS_SHINE);
    rect(7, 8, 2, 6, C_BRASS_SHINE);
    rect(8, 6, 6, 2, C_BRASS_SHINE);
    // Deep shadowed acoustic throat interior
    rect(11, 10, 4, 4, C_HORN_DEPTH);
    px(12, 11, C_BRASS_DARK);

    // 10. Right Compartment: Traditional Sushi & Sashimi Serving Tray (Funamori)
    const foodRecoilY = this.foodRecoilTimer > 0 ? 1 : 0;
    rect(42, 19 + foodRecoilY, 26, 13, C_DARK_WOOD);
    rect(43, 20 + foodRecoilY, 24, 11, C_DECK_WOOD);

    // A. Salmon Sashimi Slices
    // Top Slice
    rect(44, 21 + foodRecoilY, 9, 4, C_SUSHI_PINK);
    px(46, 22 + foodRecoilY, C_SUSHI_WHITE);
    px(50, 22 + foodRecoilY, C_SUSHI_WHITE);
    rect(44, 24 + foodRecoilY, 9, 1, C_SUSHI_RED);
    // Bottom Slice
    rect(44, 26 + foodRecoilY, 9, 4, C_SUSHI_PINK);
    px(46, 27 + foodRecoilY, C_SUSHI_WHITE);
    px(50, 27 + foodRecoilY, C_SUSHI_WHITE);
    rect(44, 29 + foodRecoilY, 9, 1, C_SUSHI_RED);

    // B. Green Bamboo Leaf Garnish
    rect(54, 20 + foodRecoilY, 3, 6, C_LEAF_GREEN);
    px(55, 19 + foodRecoilY, C_LEAF_LIGHT);
    px(54, 26 + foodRecoilY, C_LEAF_DARK);

    // C. 4 Nori Sushi Maki Rolls in a 2x2 Grid
    // Top-Left Maki (X=58..62, Y=20..24)
    rect(58, 20 + foodRecoilY, 5, 5, C_NORI_DARK);
    rect(59, 21 + foodRecoilY, 3, 3, C_SUSHI_WHITE);
    px(60, 22 + foodRecoilY, C_SUSHI_PINK);
    // Top-Right Maki (X=64..68, Y=20..24)
    rect(64, 20 + foodRecoilY, 5, 5, C_NORI_DARK);
    rect(65, 21 + foodRecoilY, 3, 3, C_SUSHI_WHITE);
    px(66, 22 + foodRecoilY, C_SUSHI_PINK);
    // Bottom-Left Maki (X=58..62, Y=26..30)
    rect(58, 26 + foodRecoilY, 5, 5, C_NORI_DARK);
    rect(59, 27 + foodRecoilY, 3, 3, C_SUSHI_WHITE);
    px(60, 28 + foodRecoilY, C_SUSHI_PINK);
    // Bottom-Right Maki (X=64..68, Y=26..30)
    rect(64, 26 + foodRecoilY, 5, 5, C_NORI_DARK);
    rect(65, 27 + foodRecoilY, 3, 3, C_SUSHI_WHITE);
    px(66, 28 + foodRecoilY, C_SUSHI_PINK);

    // D. Golden Koi Food Pellets
    rect(44, 31 + foodRecoilY, 6, 2, C_PELLET_ORANGE);
    px(45, 31 + foodRecoilY, C_PELLET_GOLD);
    px(48, 32 + foodRecoilY, C_PELLET_GOLD);

    // 9. Handcrafted Mini Anchor & Deployable Iron Chain at Bow Prow
    const C_ANCHOR_DARK = "#151e27";       // Deep forged iron outline
    const C_ANCHOR_BODY = "#2c3e50";       // Heavy cast iron
    const C_ANCHOR_STEEL = "#4a627a";      // Mid metallic tone
    const C_ANCHOR_SHINE = "#95a5a6";      // Polished metal edge gleam
    const C_CHAIN_IRON = "#566573";        // Chain link dark
    const C_CHAIN_LIGHT = "#abb2b9";       // Chain link highlight

    const anchorDropY = Math.round(this.anchorDropProgress * 22);
    const anchorY = 21 + anchorDropY;
    const hawseX = 7;
    const hawseY = 21;

    // A. Bow Hawse Hole Ring (Lỗ xỏ xích neo ở mũi thuyền)
    rect(hawseX - 1, hawseY - 1, 3, 3, C_ANCHOR_DARK);
    px(hawseX, hawseY, C_CHAIN_LIGHT);

    // B. Deployable Iron Chain Links (Dây xích sắt)
    if (anchorDropY > 0) {
      for (let cy = hawseY + 1; cy < anchorY; cy++) {
        if (cy % 2 === 0) {
          px(hawseX, cy, C_CHAIN_LIGHT);
          px(hawseX + 1, cy, C_CHAIN_IRON);
        } else {
          px(hawseX, cy, C_CHAIN_IRON);
        }
      }
    }

    // C. Handcrafted Pixel Art Mini Anchor (Mỏ neo sắt truyền thống)
    const ax = 5; // Anchor center X
    const ay = anchorY;

    // 1. Top Shackle Ring
    rect(ax + 1, ay, 3, 2, C_ANCHOR_DARK);
    px(ax + 2, ay, C_ANCHOR_SHINE);
    px(ax + 2, ay + 1, C_ANCHOR_BODY);

    // 2. Stock (Horizontal crossbar)
    rect(ax - 1, ay + 2, 7, 1, C_ANCHOR_BODY);
    px(ax - 1, ay + 2, C_ANCHOR_SHINE); // Left ball cap
    px(ax + 5, ay + 2, C_ANCHOR_SHINE); // Right ball cap
    px(ax + 2, ay + 2, C_ANCHOR_STEEL); // Center collar

    // 3. Shank (Vertical iron shaft)
    rect(ax + 1, ay + 3, 2, 4, C_ANCHOR_BODY);
    rect(ax + 2, ay + 3, 1, 4, C_ANCHOR_DARK); // Shadow line

    // 4. Curved Arms & Flukes (Cặp móc neo uốn cong sắc nét)
    px(ax - 1, ay + 5, C_ANCHOR_SHINE);  // Left fluke sharp palm
    px(ax + 5, ay + 5, C_ANCHOR_SHINE);  // Right fluke sharp palm
    px(ax, ay + 6, C_ANCHOR_STEEL);      // Left arm curve
    px(ax + 4, ay + 6, C_ANCHOR_DARK);   // Right arm curve
    rect(ax, ay + 7, 5, 1, C_ANCHOR_BODY); // Bottom crown curve
    px(ax + 1, ay + 7, C_ANCHOR_STEEL);
    px(ax + 2, ay + 8, C_ANCHOR_DARK);   // Crown center point

    // 5. Water Surface Submersion Caustics (Khi mỏ neo chìm dưới nước)
    if (ay >= 38) {
      px(ax - 2, 47, "rgba(186, 230, 253, 0.45)");
      px(ax + 6, 47, "rgba(186, 230, 253, 0.45)");
      px(ax + 2, ay + 2, "rgba(103, 232, 249, 0.35)");
      px(ax + 2, ay + 6, "rgba(103, 232, 249, 0.35)");
    }

    // Commit offscreen canvas updates into Three.js texture
    this.texture.needsUpdate = true;
  }

  /**
   * Synchronize Three.js transforms and shadow placement.
   */
  private updateTransforms(
    _time: number,
    shadowInfo = { x: 2.2, y: 3.8, opacity: 0.36 },
  ): void {
    const scale = this.options.scale;
    if (scale <= 0.001) return;

    const width = BOAT_BASE_WIDTH * scale;
    const height = BOAT_BASE_HEIGHT * scale;
    const flipX = this.facingLeft ? 1 : -1;

    // Boat Plane Transform
    const posX = this.options.position.x;
    const posY = this.options.position.y + this.bobY;

    this.mesh.position.set(posX, posY, 0.05);
    this.mesh.rotation.z = this.pitchAngle * flipX;
    this.mesh.scale.set(width * flipX, -height, 1);

    // Contact Shadow Transform
    const shadowX = posX + shadowInfo.x * scale;
    const shadowY = posY + shadowInfo.y * scale;

    this.shadowMesh.position.set(shadowX, shadowY, 0.02);
    this.shadowMesh.rotation.z = this.pitchAngle * 0.7 * flipX;
    this.shadowMesh.scale.set(width * flipX, -height * 0.75, 1);
  }

  public getNotes(): readonly MusicNoteParticle[] {
    return this.notes;
  }

  public getPellets(): readonly FoodPelletParticle[] {
    return this.pellets;
  }

  public dispose(): void {
    this.texture.dispose();
    this.notesTexture.dispose();
    this.material.dispose();
    this.shadowMaterial.dispose();
    this.mesh.geometry.dispose();
    this.shadowMesh.geometry.dispose();
    this.noteGeometry.dispose();
    this.pelletGeometry.dispose();
    this.pelletShadowGeometry.dispose();
    this.wakeTrail.dispose();
  }
}
