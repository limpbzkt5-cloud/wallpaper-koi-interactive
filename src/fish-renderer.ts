import * as THREE from "three";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  KOI_PALETTES,
  MAX_FISH,
  SPINE_NODES,
} from "./config";
import { ButterflyPass } from "./butterflies";
import { DuckweedPass } from "./duckweed";
import {
  createFishAppearance,
  patchesFor,
  type FishAppearance,
} from "./fish-appearance";
import { Koi, SwimState } from "./koi";
import { FishMutation, applyMutationColors } from "./mutations";
import { LotusLeavesPass } from "./lotus-leaves";
import {
  add,
  fromAngle,
  lerp,
  mul,
  normalize,
  perpendicular,
  sub,
  type Vec2,
} from "./math";
import { PondBedPass } from "./pond-bed";
import { School } from "./school";
import { SurfaceDisturbancePass } from "./surface-disturbance";
import { TinyFishRenderer } from "./tiny-fish-renderer";
import { WaterSurfacePass } from "./water-surface";
import { WeatherPass } from "./weather-pass";
import type { WeatherPresetId } from "./weather";
import { PondClock, type ClockMode } from "./pond-clock";

const TRIANGLE_FLOAT_CAPACITY = 144_000;
const LINE_FLOAT_CAPACITY = 18_000;
const DEFAULT_COLOR = new THREE.Color(0xffffff);
const PASTEL_GEM_COLORS = [
  new THREE.Color("#ffb3ba"),
  new THREE.Color("#ffdfba"),
  new THREE.Color("#ffffba"),
  new THREE.Color("#baffc9"),
  new THREE.Color("#bae1ff"),
  new THREE.Color("#c5c6ff"),
  new THREE.Color("#e8c5ff"),
];

const shadowVertexShader = /* glsl */ `
  varying float vStrength;
  void main() {
    vStrength = color.r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shadowFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vStrength;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * vStrength);
  }
`;

function shadowMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(FISH.shadow.color) },
      uOpacity: { value: opacity },
    },
    vertexShader: shadowVertexShader,
    fragmentShader: shadowFragmentShader,
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

class GeometryBatch {
  private readonly values: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private readonly colorValues?: Float32Array;
  private readonly colorAttribute?: THREE.BufferAttribute;
  private cursor = 0;
  private previewOrigin: Vec2 | null = null;
  private previewScale = 1;

  public constructor(
    private readonly geometry: THREE.BufferGeometry,
    capacity: number,
    includeColors = false,
  ) {
    this.values = new Float32Array(capacity);
    this.attribute = new THREE.BufferAttribute(this.values, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.attribute);
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, 0),
      Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT),
    );
    if (includeColors) {
      this.colorValues = new Float32Array(capacity);
      this.colorAttribute = new THREE.BufferAttribute(this.colorValues, 3);
      this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute("color", this.colorAttribute);
    }
  }

  public reset(): void {
    this.cursor = 0;
  }

  public setPreviewTransform(origin: Vec2 | null, scale = 1): void {
    this.previewOrigin = origin;
    this.previewScale = scale;
  }

  public point(point: Vec2, color: THREE.Color = DEFAULT_COLOR): void {
    if (this.cursor + 3 > this.values.length) return;
    this.values[this.cursor] = this.previewOrigin
      ? CANVAS_WIDTH * 0.5 + (point.x - this.previewOrigin.x) * this.previewScale
      : point.x;
    this.values[this.cursor + 1] = this.previewOrigin
      ? CANVAS_HEIGHT * 0.5 + (point.y - this.previewOrigin.y) * this.previewScale
      : point.y;
    this.values[this.cursor + 2] = 0;
    if (this.colorValues) {
      this.colorValues[this.cursor] = color.r;
      this.colorValues[this.cursor + 1] = color.g;
      this.colorValues[this.cursor + 2] = color.b;
    }
    this.cursor += 3;
  }

  public triangle(a: Vec2, b: Vec2, c: Vec2, color: THREE.Color = DEFAULT_COLOR): void {
    this.point(a, color);
    this.point(b, color);
    this.point(c, color);
  }

  public line(a: Vec2, b: Vec2, color: THREE.Color = DEFAULT_COLOR): void {
    this.point(a, color);
    this.point(b, color);
  }

  public circle(
    center: Vec2,
    radius: number,
    color: THREE.Color = DEFAULT_COLOR,
    segments = 12,
  ): void {
    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      this.triangle(
        center,
        add(center, mul(fromAngle(angleA), radius)),
        add(center, mul(fromAngle(angleB), radius)),
        color,
      );
    }
  }

  public ellipse(
    center: Vec2,
    forward: Vec2,
    normal: Vec2,
    forwardRadius: number,
    sideRadius: number,
    color: THREE.Color,
    phase: number,
    segments = 10,
  ): void {
    const pointAt = (angle: number): Vec2 => {
      const wobble =
        1 +
        Math.sin(angle * 3 + phase) * 0.08 +
        Math.cos(angle * 2 - phase * 0.7) * 0.045;
      return add(
        add(center, mul(forward, Math.cos(angle) * forwardRadius * wobble)),
        mul(normal, Math.sin(angle) * sideRadius * wobble),
      );
    };

    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      this.triangle(center, pointAt(angleA), pointAt(angleB), color);
    }
  }

  public commit(): void {
    this.geometry.setDrawRange(0, this.cursor / 3);
    this.attribute.clearUpdateRanges();
    this.attribute.addUpdateRange(0, this.cursor);
    this.attribute.needsUpdate = true;
    if (this.colorAttribute) {
      this.colorAttribute.clearUpdateRanges();
      this.colorAttribute.addUpdateRange(0, this.cursor);
      this.colorAttribute.needsUpdate = true;
    }
  }
}

export class FishRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly bedScene = new THREE.Scene();
  private readonly shadowScene = new THREE.Scene();
  private readonly fishShadowScene = new THREE.Scene();
  private readonly fishScene = new THREE.Scene();
  private readonly surfaceScene = new THREE.Scene();
  private readonly surfaceShadowScene = new THREE.Scene();
  private readonly surfaceObjectScene = new THREE.Scene();
  private readonly weatherScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(
    0,
    CANVAS_WIDTH,
    0,
    CANVAS_HEIGHT,
    -10,
    10,
  );
  private readonly surfaceCamera = new THREE.Camera();
  private readonly underwaterTarget: THREE.WebGLRenderTarget;
  private readonly compositeTarget: THREE.WebGLRenderTarget;
  private readonly pondBed: PondBedPass;
  private readonly surfaceDisturbance = new SurfaceDisturbancePass();
  private readonly waterSurface: WaterSurfacePass;
  private readonly weather: WeatherPass;
  private readonly tinyFishRenderer = new TinyFishRenderer();
  private readonly duckweed = new DuckweedPass();
  private readonly lotusLeaves = new LotusLeavesPass();
  private readonly butterflies = new ButterflyPass();
  private readonly fishShadowMaterial = shadowMaterial(1);
  private readonly shadowTriangles: GeometryBatch;
  private readonly fishTriangles: GeometryBatch;
  private readonly outerTriangles: GeometryBatch;
  private readonly bodyTriangles: GeometryBatch;
  private readonly outlineLines: GeometryBatch;
  private readonly appearances = Array.from(
    { length: MAX_FISH + 2 },
    (_, index) => createFishAppearance(index),
  );
  private readonly depthAppearances = Array.from(
    { length: MAX_FISH + 2 },
    (_, index) => createFishAppearance(index),
  );
  private readonly shadowStrengthColor = new THREE.Color();
  private readonly targetFishShadowColor = new THREE.Color(FISH.shadow.color);
  private previousAppearanceTime = -1;
  private currentVisualDepth = 0;
  private previewFamilyIndex: number | null = null;
  public readonly pondClock = new PondClock();
  private readonly underwaterClockScene = new THREE.Scene();
  private readonly floatingClockScene = new THREE.Scene();
  private activeWeatherId: WeatherPresetId = "sunny";

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.underwaterTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.underwaterTarget.texture.generateMipmaps = false;

    this.compositeTarget = new THREE.WebGLRenderTarget(CANVAS_WIDTH, CANVAS_HEIGHT, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.compositeTarget.texture.generateMipmaps = false;

    this.pondBed = new PondBedPass();
    this.waterSurface = new WaterSurfacePass(
      this.underwaterTarget.texture,
      this.surfaceDisturbance.texture,
    );
    this.weather = new WeatherPass(this.compositeTarget.texture);
    this.bedScene.add(this.pondBed.mesh);
    this.shadowScene.add(
      this.lotusLeaves.shadowGroup,
      this.tinyFishRenderer.shadowGroup,
    );
    this.fishScene.add(this.tinyFishRenderer.group);
    this.surfaceScene.add(this.waterSurface.mesh);
    this.surfaceShadowScene.add(
      this.duckweed.shadowGroup,
      this.butterflies.shadowGroup,
    );
    this.surfaceObjectScene.add(
      this.duckweed.group,
      this.lotusLeaves.group,
      this.butterflies.group,
    );
    this.weatherScene.add(this.weather.mesh);

    const shadowGeometry = new THREE.BufferGeometry();
    const fishGeometry = new THREE.BufferGeometry();
    const lineGeometry = new THREE.BufferGeometry();
    shadowGeometry.name = "fish shadows";
    fishGeometry.name = "fish geometry";
    lineGeometry.name = "fish debug lines";
    this.shadowTriangles = new GeometryBatch(
      shadowGeometry,
      TRIANGLE_FLOAT_CAPACITY,
      true,
    );
    this.fishTriangles = new GeometryBatch(fishGeometry, TRIANGLE_FLOAT_CAPACITY * 2, true);
    this.outerTriangles = this.fishTriangles;
    this.bodyTriangles = this.fishTriangles;
    this.outlineLines = new GeometryBatch(lineGeometry, LINE_FLOAT_CAPACITY, true);

    const fishMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const shadowMesh = new THREE.Mesh(shadowGeometry, this.fishShadowMaterial);
    const fishMesh = new THREE.Mesh(fishGeometry, fishMaterial);
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    shadowMesh.frustumCulled = false;
    fishMesh.frustumCulled = false;
    lines.frustumCulled = false;
    fishMesh.renderOrder = 1;
    lines.renderOrder = 2;
    this.fishShadowScene.add(shadowMesh);
    this.fishScene.add(fishMesh, lines);
    this.underwaterClockScene.add(this.pondClock.mesh);
  }

  public setClockMode(mode: ClockMode): void {
    this.pondClock.setMode(mode);
    if (mode === "off") {
      this.underwaterClockScene.remove(this.pondClock.mesh);
      this.floatingClockScene.remove(this.pondClock.mesh);
    } else if (mode === "submerged") {
      this.underwaterClockScene.add(this.pondClock.mesh);
      this.floatingClockScene.remove(this.pondClock.mesh);
    } else {
      this.floatingClockScene.add(this.pondClock.mesh);
      this.underwaterClockScene.remove(this.pondClock.mesh);
    }
  }

  public refreshConfig(): void {
    for (const section of [
      "koi", "koi-palettes", "tiny-fish", "pond-bed", "water",
      "lotus", "duckweed", "butterflies",
    ]) this.refreshSection(section);
  }

  public refreshSection(sectionId: string): void {
    switch (sectionId) {
      case "koi":
        this.targetFishShadowColor.setHex(FISH.shadow.color);
        // Eye color and the shared koi palette are baked into appearances.
        this.refreshFishAppearances();
        break;
      case "koi-palettes":
      case "koi-patterns":
        this.refreshFishAppearances();
        break;
      case "tiny-fish":
        this.tinyFishRenderer.refreshConfig();
        break;
      case "pond-bed":
        this.pondBed.refreshConfig();
        break;
      case "water":
        this.waterSurface.refreshConfig();
        break;
      case "lotus":
        this.lotusLeaves.refreshConfig();
        break;
      case "duckweed":
      case "duckweed-patches":
        this.duckweed.refreshConfig();
        break;
      case "butterflies":
        this.butterflies.refreshConfig(true);
        break;
      case "butterfly-spawns":
        this.butterflies.refreshConfig();
        break;
      default:
        break;
    }
  }

  private refreshFishAppearances(): void {
    for (let index = 0; index < this.appearances.length; index += 1) {
      this.appearances[index] = createFishAppearance(index);
      this.depthAppearances[index] = createFishAppearance(index);
    }
  }

  public resize(width: number, height: number, oldWidth: number, oldHeight: number): void {
    this.renderer.setSize(width, height, false);
    this.underwaterTarget.setSize(width, height);
    this.compositeTarget.setSize(width, height);
    this.camera.right = width;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
    this.pondBed.resize(width, height);
    this.surfaceDisturbance.resize(width, height);
    this.waterSurface.resize(width, height);
    this.butterflies.resize(width / oldWidth, height / oldHeight);
    this.pondClock.updatePosition();
  }

  public dispose(): void {
    this.pondClock.dispose();
    this.underwaterTarget.dispose();
    this.compositeTarget.dispose();
    this.surfaceDisturbance.dispose();
    this.fishShadowMaterial.dispose();
    this.weather.dispose();
    this.renderer.dispose();
  }

  public setWeatherPreset(id: WeatherPresetId): void {
    this.activeWeatherId = id;
    this.weather.setPreset(id);
    this.pondClock.forceRedraw();
  }

  public setPreviewFamily(index: number | null): void {
    this.previewFamilyIndex = index;
  }

  public draw(school: School, time: number, showDebug: boolean): void {
    if (this.previousAppearanceTime >= 0) {
      const deltaTime = Math.min(
        0.1,
        Math.max(0, time - this.previousAppearanceTime),
      );
      const blend = 1 - Math.exp(-deltaTime * 2.25);
      this.fishShadowMaterial.uniforms.uColor.value.lerp(
        this.targetFishShadowColor,
        blend,
      );
    }
    this.previousAppearanceTime = time;
    this.shadowTriangles.reset();
    this.fishTriangles.reset();
    this.outlineLines.reset();

    const previewIndex = this.previewFamilyIndex;
    let selectedFishIndex = 0;
    if (previewIndex !== null) {
      for (let index = 0; index < school.count; index += 1) {
        if (
          index % KOI_PALETTES.length === previewIndex &&
          (index + 1) % FISH.tinyEvery !== 0
        ) {
          selectedFishIndex = index;
          break;
        }
      }
    }
    const transformOrigin = previewIndex === null
      ? null
      : school.fish[selectedFishIndex].position;
    for (const batch of [this.shadowTriangles, this.fishTriangles, this.outlineLines]) {
      batch.setPreviewTransform(transformOrigin, previewIndex === null ? 1 : 1.6);
    }

    const active = school.activeIndices();
    const sortedActive = [...active].sort(
      (a, b) => school.fish[b].depth - school.fish[a].depth,
    );
    for (const index of sortedActive) {
      if (previewIndex !== null && index !== selectedFishIndex) continue;
      const fish = school.fish[index];
      this.buildRenderSpine(fish);
      const appearanceIndex = previewIndex ?? Math.min(index, this.appearances.length - 1);
      const appearance = this.depthAppearances[appearanceIndex];
      this.updateDepthAppearance(fish, this.appearances[appearanceIndex], appearance, time);
      this.drawKoi(fish, appearance);
      if (showDebug) this.drawDebug(fish, appearance);
    }

    this.shadowTriangles.commit();
    this.fishTriangles.commit();
    this.outlineLines.commit();
    this.tinyFishRenderer.group.visible = previewIndex === null;
    this.tinyFishRenderer.shadowGroup.visible = previewIndex === null;
    if (previewIndex === null) this.tinyFishRenderer.update(school.tinyFish);
    this.pondBed.update(time);
    this.surfaceDisturbance.render(
      this.renderer,
      school,
      time,
      previewIndex === null ? null : selectedFishIndex,
    );
    this.waterSurface.update(school, time);
    this.duckweed.update(time, school.ripples);
    this.lotusLeaves.update(time, school.ripples);
    this.butterflies.update(time);

    this.pondClock.update(new Date(), this.activeWeatherId, time, school.ripples);

    this.renderer.setRenderTarget(this.underwaterTarget);
    this.renderer.clear();
    this.renderer.autoClear = false;
    this.renderer.render(this.bedScene, this.camera);
    this.renderer.render(this.shadowScene, this.camera);
    this.renderer.render(this.fishShadowScene, this.camera);
    this.renderer.render(this.fishScene, this.camera);
    if (this.pondClock.options.enabled && this.pondClock.options.mode === "submerged") {
      this.renderer.render(this.underwaterClockScene, this.camera);
    }
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.clear();
    this.renderer.render(this.surfaceScene, this.surfaceCamera);
    this.renderer.autoClear = false;
    this.renderer.render(this.surfaceShadowScene, this.camera);
    this.renderer.render(this.surfaceObjectScene, this.camera);
    if (this.pondClock.options.enabled && this.pondClock.options.mode === "floating") {
      this.renderer.render(this.floatingClockScene, this.camera);
    }
    this.renderer.autoClear = true;
    this.weather.update(time);
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.weatherScene, this.surfaceCamera);
  }

  private buildRenderSpine(fish: Koi): void {
    fish.renderSpine[0] = { ...fish.spine[0] };
    for (let node = 1; node < SPINE_NODES; node += 1) {
      const t = node / (SPINE_NODES - 1);
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(
        sub(fish.spine[previous], fish.spine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(tangent);
      // Posterior concentration: head and pectoral thorax remain stable, propulsion concentrated in caudal tail
      const waveEnvelope = Math.pow(t, 2.2);
      const wave =
        fish.mutation === FishMutation.Frozen
          ? 0
          : Math.sin(fish.swimPhase - t * 5.8) *
            fish.bodyWidth *
            0.65 *
            waveEnvelope *
            (0.10 + fish.tailEffort * 0.90);
      fish.renderSpine[node] = add(fish.spine[node], mul(normal, wave));
    }
  }

  private widthAt(fish: Koi, node: number): number {
    const t = node / (SPINE_NODES - 1);
    const profile =
      t < 0.18
        ? 0.73 + (t / 0.18) * 0.27
        : Math.pow(Math.max(0, 1 - (t - 0.18) / 0.82), 0.72);
    return Math.max(0.7, fish.bodyWidth * profile);
  }

  private visualDepth(depth: number): number {
    const range = Math.max(FISH.depth.visualEnd - FISH.depth.visualStart, 0.001);
    const linear = Math.max(
      0,
      Math.min(1, (depth - FISH.depth.visualStart) / range),
    );
    return linear * linear * (3 - 2 * linear);
  }

  private updateDepthAppearance(
    fish: Koi,
    source: FishAppearance,
    target: FishAppearance,
    time: number = 0,
  ): void {
    if (fish.mutation !== FishMutation.None) {
      applyMutationColors(
        target.base,
        target.accent,
        target.marking,
        target.fin,
        target.eye,
        fish.mutation,
        time,
      );
      const isLuminescent =
        fish.mutation === FishMutation.Umbra ||
        fish.mutation === FishMutation.Aurora ||
        fish.mutation === FishMutation.Midas ||
        fish.mutation === FishMutation.Electric ||
        fish.mutation === FishMutation.Nuclear ||
        fish.mutation === FishMutation.Mythical ||
        fish.mutation === FishMutation.RainbowCluster ||
        fish.mutation === FishMutation.Serene ||
        fish.mutation === FishMutation.Astraeus;
      const visualDepth = this.visualDepth(fish.depth) * (isLuminescent ? 0.35 : 1.0);
      this.applyDepthColor(target.base, target.base, visualDepth);
      this.applyDepthColor(target.accent, target.accent, visualDepth);
      this.applyDepthColor(target.marking, target.marking, visualDepth);
      this.applyDepthColor(target.fin, target.fin, visualDepth);
      this.applyDepthColor(target.eye, target.eye, visualDepth);
      return;
    }
    const visualDepth = this.visualDepth(fish.depth);
    this.applyDepthColor(source.base, target.base, visualDepth);
    this.applyDepthColor(source.accent, target.accent, visualDepth);
    this.applyDepthColor(source.marking, target.marking, visualDepth);
    this.applyDepthColor(source.fin, target.fin, visualDepth);
    this.applyDepthColor(source.eye, target.eye, visualDepth);
  }

  private applyDepthColor(
    source: THREE.Color,
    target: THREE.Color,
    visualDepth: number,
  ): void {
    const brightness = 1 + (FISH.depth.deepBrightness - 1) * visualDepth;
    const saturation = 1 + (FISH.depth.deepSaturation - 1) * visualDepth;
    const luminance = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722;
    const [tintR, tintG, tintB] = FISH.depth.deepWaterTint;
    target.setRGB(
      (luminance + (source.r - luminance) * saturation) *
        brightness *
        (1 + (tintR - 1) * visualDepth),
      (luminance + (source.g - luminance) * saturation) *
        brightness *
        (1 + (tintG - 1) * visualDepth),
      (luminance + (source.b - luminance) * saturation) *
        brightness *
        (1 + (tintB - 1) * visualDepth),
    );
  }

  private addShadowTriangle(a: Vec2, b: Vec2, c: Vec2): void {
    const shadowOffset = {
      x:
        FISH.shadow.offset.x +
        FISH.shadow.depthOffset.x * this.currentVisualDepth,
      y:
        FISH.shadow.offset.y +
        FISH.shadow.depthOffset.y * this.currentVisualDepth,
    };
    const opacity =
      FISH.shadow.surfaceOpacity +
      (FISH.shadow.deepOpacity - FISH.shadow.surfaceOpacity) *
        this.currentVisualDepth;
    this.shadowStrengthColor.setRGB(
      opacity,
      opacity,
      opacity,
    );
    this.shadowTriangles.triangle(
      add(a, shadowOffset),
      add(b, shadowOffset),
      add(c, shadowOffset),
      this.shadowStrengthColor,
    );
  }

  private addShadowCircle(center: Vec2, radius: number): void {
    const shadowOffset = {
      x:
        FISH.shadow.offset.x +
        FISH.shadow.depthOffset.x * this.currentVisualDepth,
      y:
        FISH.shadow.offset.y +
        FISH.shadow.depthOffset.y * this.currentVisualDepth,
    };
    const opacity =
      FISH.shadow.surfaceOpacity +
      (FISH.shadow.deepOpacity - FISH.shadow.surfaceOpacity) *
        this.currentVisualDepth;
    this.shadowStrengthColor.setRGB(
      opacity,
      opacity,
      opacity,
    );
    this.shadowTriangles.circle(
      add(center, shadowOffset),
      radius,
      this.shadowStrengthColor,
    );
  }

  private silhouetteTriangle(
    a: Vec2,
    b: Vec2,
    c: Vec2,
    color: THREE.Color,
  ): void {
    this.addShadowTriangle(a, b, c);
    this.outerTriangles.triangle(a, b, c, color);
  }

  private silhouetteCircle(center: Vec2, radius: number, color: THREE.Color): void {
    this.addShadowCircle(center, radius);
    this.outerTriangles.circle(center, radius, color);
  }

  private drawUmbraCelestialHalo(fish: Koi, appearance: FishAppearance): void {
    const eclipseCenter = lerp(fish.renderSpine[2], fish.renderSpine[4], 0.5);
    const voidRadius = Math.max(9.5, fish.bodyLength * 0.38);
    const rimThickness = Math.max(0.75, fish.bodyWidth * 0.16);
    const rimRadius = voidRadius + rimThickness;
    const numRays = 32;
    const angleStep = (Math.PI * 2) / numRays;
    const baseRotation = fish.swimPhase * 0.15;

    const goldColor = appearance.accent;
    const lavenderColor = appearance.marking;

    // 1. Detailed radiating sunbeams / god rays in 360 degrees
    for (let j = 0; j < numRays; j += 1) {
      const angle = j * angleStep + baseRotation;
      const isEven = j % 2 === 0;
      const rayColor = isEven ? goldColor : lavenderColor;

      const mod4 = j % 4;
      const shimmer = Math.sin(fish.swimPhase * 1.8 + j * 0.85) * 0.12;
      let reachMultiplier = 1.38;
      if (mod4 === 0) reachMultiplier = 2.20 + shimmer;      // Primary long beams
      else if (mod4 === 2) reachMultiplier = 1.80 + shimmer; // Secondary medium beams
      else reachMultiplier = 1.42 + shimmer;                 // Intermediate beams

      const rayReach = voidRadius * reachMultiplier;
      const halfArc = angleStep * 0.38;

      const base1 = add(eclipseCenter, mul(fromAngle(angle - halfArc), rimRadius));
      const base2 = add(eclipseCenter, mul(fromAngle(angle + halfArc), rimRadius));
      const tip = add(eclipseCenter, mul(fromAngle(angle), rayReach));

      this.outerTriangles.triangle(base1, tip, base2, rayColor);

      // Detailed inner core for primary beams to make rays look sharp and multi-layered
      if (mod4 === 0 || mod4 === 2) {
        const innerHalfArc = angleStep * 0.16;
        const innerBase1 = add(eclipseCenter, mul(fromAngle(angle - innerHalfArc), rimRadius));
        const innerBase2 = add(eclipseCenter, mul(fromAngle(angle + innerHalfArc), rimRadius));
        const innerTip = add(eclipseCenter, mul(fromAngle(angle), rayReach * 0.90));
        this.outerTriangles.triangle(innerBase1, innerTip, innerBase2, appearance.eye);
      }
    }

    // 2. Radiant Solar Neon Gold Ring
    const segments = 28;
    for (let s = 0; s < segments; s += 1) {
      const a1 = (s / segments) * Math.PI * 2;
      const a2 = ((s + 1) / segments) * Math.PI * 2;
      const pInner1 = add(eclipseCenter, mul(fromAngle(a1), voidRadius));
      const pInner2 = add(eclipseCenter, mul(fromAngle(a2), voidRadius));
      const pOuter1 = add(eclipseCenter, mul(fromAngle(a1), rimRadius));
      const pOuter2 = add(eclipseCenter, mul(fromAngle(a2), rimRadius));

      this.outerTriangles.triangle(pInner1, pOuter1, pOuter2, goldColor);
      this.outerTriangles.triangle(pInner1, pOuter2, pInner2, goldColor);
    }

    // 3. Deep Cosmic Void Core (Black moon circle behind koi)
    this.outerTriangles.circle(eclipseCenter, voidRadius, appearance.base, segments);
  }

  private drawKoi(fish: Koi, appearance: FishAppearance): void {
    this.currentVisualDepth = this.visualDepth(fish.depth);
    if (fish.mutation === FishMutation.Umbra) {
      this.drawUmbraCelestialHalo(fish, appearance);
    } else if (fish.mutation === FishMutation.Frozen) {
      this.drawFrozenIceCubeShadow(fish);
    }
    const left: Vec2[] = [];
    const right: Vec2[] = [];

    for (let node = 0; node < SPINE_NODES; node += 1) {
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(
        sub(fish.renderSpine[previous], fish.renderSpine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(tangent);
      const halfWidth = this.widthAt(fish, node);
      left[node] = add(fish.renderSpine[node], mul(normal, halfWidth));
      right[node] = add(fish.renderSpine[node], mul(normal, -halfWidth));
    }

    const pectoralFront = 3;
    const pectoralCenter = 4;
    const pectoralBack = 6;
    const pectoralTangent = normalize(
      sub(fish.renderSpine[pectoralCenter - 1], fish.renderSpine[pectoralCenter + 1]),
      fromAngle(fish.heading),
    );
    const pectoralNormal = perpendicular(pectoralTangent);
    const isFrozen = fish.mutation === FishMutation.Frozen;
    const gulpProgress = isFrozen
      ? 0
      : fish.gulpAnimation / Math.max(FISH.feeding.animationDurationSeconds, 0.001);
    const gulpPaddle = Math.sin(Math.PI * gulpProgress) * 0.85;
    const paddleActivity = isFrozen
      ? 0
      : (fish.state === SwimState.Hover ? 1 : fish.state === SwimState.Pivot ? 0.85 : 0.45)
        + gulpPaddle;
    const finPulse = isFrozen
      ? 0.85
      : 0.82 +
        paddleActivity * 0.25 * Math.sin(fish.swimPhase * 0.64 + fish.phaseOffset);
    const pectoralReach =
      fish.bodyWidth * (0.55 + paddleActivity * 0.25) * finPulse;
    const leftPectoral = add(
      add(left[pectoralCenter], mul(pectoralNormal, pectoralReach)),
      mul(pectoralTangent, -fish.bodyWidth * 0.22),
    );
    const rightPectoral = add(
      add(right[pectoralCenter], mul(pectoralNormal, -pectoralReach)),
      mul(pectoralTangent, -fish.bodyWidth * 0.22),
    );
    this.silhouetteTriangle(
      left[pectoralFront],
      leftPectoral,
      left[pectoralBack],
      appearance.fin,
    );
    this.silhouetteTriangle(
      right[pectoralFront],
      right[pectoralBack],
      rightPectoral,
      appearance.fin,
    );

    const pelvicFront = 7;
    const pelvicCenter = 8;
    const pelvicBack = 9;
    const pelvicTangent = normalize(
      sub(fish.renderSpine[pelvicCenter - 1], fish.renderSpine[pelvicCenter + 1]),
      fromAngle(fish.heading),
    );
    const pelvicNormal = perpendicular(pelvicTangent);
    const pelvicReach = fish.bodyWidth * (0.28 + 0.05 * finPulse);
    const leftPelvic = add(left[pelvicCenter], mul(pelvicNormal, pelvicReach));
    const rightPelvic = add(right[pelvicCenter], mul(pelvicNormal, -pelvicReach));
    this.silhouetteTriangle(
      left[pelvicFront],
      leftPelvic,
      left[pelvicBack],
      appearance.fin,
    );
    this.silhouetteTriangle(
      right[pelvicFront],
      right[pelvicBack],
      rightPelvic,
      appearance.fin,
    );

    for (let node = SPINE_NODES - 2; node >= 0; node -= 1) {
      this.silhouetteTriangle(
        left[node],
        right[node],
        right[node + 1],
        appearance.base,
      );
      this.silhouetteTriangle(
        left[node],
        right[node + 1],
        left[node + 1],
        appearance.base,
      );
    }

    const headForward = normalize(
      sub(fish.renderSpine[0], fish.renderSpine[1]),
      fromAngle(fish.heading),
    );
    const headNormal = perpendicular(headForward);
    const noseCenter = add(fish.renderSpine[0], mul(headForward, fish.bodyWidth * 0.43));
    const noseHalfWidth = this.widthAt(fish, 0) * 0.72;
    const noseLeft = add(noseCenter, mul(headNormal, noseHalfWidth));
    const noseRight = add(noseCenter, mul(headNormal, -noseHalfWidth));
    this.silhouetteTriangle(left[0], noseLeft, noseRight, appearance.base);
    this.silhouetteTriangle(left[0], noseRight, right[0], appearance.base);
    this.silhouetteCircle(
      noseCenter,
      Math.max(1, noseHalfWidth * 0.72),
      appearance.base,
    );

    const tailNode = SPINE_NODES - 1;
    const tailForward = normalize(
      sub(fish.renderSpine[tailNode - 1], fish.renderSpine[tailNode]),
      fromAngle(fish.heading),
    );
    const tailNormal = perpendicular(tailForward);
    const tailBackward = mul(tailForward, -1);
    const tailSpread = isFrozen
      ? fish.bodyWidth * 0.58
      : fish.bodyWidth * (0.58 + 0.08 * Math.sin(fish.swimPhase - 0.8));
    const upperFin = add(
      add(fish.renderSpine[tailNode], mul(tailBackward, fish.bodyWidth * 1.38)),
      mul(tailNormal, tailSpread),
    );
    const lowerFin = add(
      add(fish.renderSpine[tailNode], mul(tailBackward, fish.bodyWidth * 1.38)),
      mul(tailNormal, -tailSpread),
    );
    const tailNotch = add(
      fish.renderSpine[tailNode],
      mul(tailBackward, fish.bodyWidth * 0.86),
    );
    this.silhouetteTriangle(
      fish.renderSpine[tailNode],
      upperFin,
      tailNotch,
      appearance.fin,
    );
    this.silhouetteTriangle(
      fish.renderSpine[tailNode],
      tailNotch,
      lowerFin,
      appearance.fin,
    );

    // Pattern positions are authored in normalized body space. The shapes sample
    // the live spine, so they stay attached when the fish bends and turns.
    for (const [patchIndex, patch] of patchesFor(appearance).entries()) {
      const spinePosition = patch.position * (SPINE_NODES - 1);
      const node = Math.min(SPINE_NODES - 2, Math.floor(spinePosition));
      const amount = spinePosition - node;
      const center = lerp(fish.renderSpine[node], fish.renderSpine[node + 1], amount);
      const previous = Math.max(0, node - 1);
      const next = Math.min(SPINE_NODES - 1, node + 2);
      const forward = normalize(
        sub(fish.renderSpine[previous], fish.renderSpine[next]),
        fromAngle(fish.heading),
      );
      const normal = perpendicular(forward);
      const localWidth =
        this.widthAt(fish, node) * (1 - amount) +
        this.widthAt(fish, node + 1) * amount;
      const patchCenter = add(center, mul(normal, localWidth * patch.offset));
      const patchColor =
        patch.color === "accent" ? appearance.accent : appearance.marking;

      this.bodyTriangles.ellipse(
        patchCenter,
        forward,
        normal,
        fish.bodyLength * patch.length,
        localWidth * patch.width,
        patchColor,
        patchIndex * 1.73 + patch.position * 5.1,
      );
    }

    const eyeAnchor = add(
      fish.renderSpine[0],
      mul(headForward, fish.bodyWidth * 0.08),
    );
    const eyeOffset = this.widthAt(fish, 0) * 0.58;
    const eyeRadius = Math.max(0.58, fish.bodyWidth * 0.11);
    this.bodyTriangles.circle(
      add(eyeAnchor, mul(headNormal, eyeOffset)),
      eyeRadius,
      appearance.eye,
      6,
    );
    this.bodyTriangles.circle(
      add(eyeAnchor, mul(headNormal, -eyeOffset)),
      eyeRadius,
      appearance.eye,
      6,
    );

    if (fish.mutation === FishMutation.Bunny) {
      const earOffset = this.widthAt(fish, 0) * 0.42;
      const earLength = fish.bodyLength * 0.22;
      const earWidth = fish.bodyWidth * 0.28;
      const wiggle = Math.sin(fish.swimPhase * 0.85) * 0.12;

      // Left ear (beige outer + pastel pink inner)
      const leftEarBase = add(fish.renderSpine[0], mul(headNormal, earOffset));
      const leftEarDir = normalize(
        add(mul(headForward, -0.75 + wiggle), mul(headNormal, 0.45)),
        mul(headForward, -1),
      );
      const leftEarNormal = perpendicular(leftEarDir);
      const leftEarTip = add(leftEarBase, mul(leftEarDir, earLength));
      const leftEarP1 = add(leftEarBase, mul(leftEarNormal, earWidth * 0.5));
      const leftEarP2 = add(leftEarBase, mul(leftEarNormal, -earWidth * 0.5));
      this.silhouetteTriangle(leftEarP1, leftEarTip, leftEarP2, appearance.base);

      const leftInnerTip = add(leftEarBase, mul(leftEarDir, earLength * 0.72));
      const leftInnerP1 = add(leftEarBase, mul(leftEarNormal, earWidth * 0.26));
      const leftInnerP2 = add(leftEarBase, mul(leftEarNormal, -earWidth * 0.26));
      this.bodyTriangles.triangle(leftInnerP1, leftInnerTip, leftInnerP2, appearance.accent);

      // Right ear (beige outer + pastel pink inner)
      const rightEarBase = add(fish.renderSpine[0], mul(headNormal, -earOffset));
      const rightEarDir = normalize(
        add(mul(headForward, -0.75 - wiggle), mul(headNormal, -0.45)),
        mul(headForward, -1),
      );
      const rightEarNormal = perpendicular(rightEarDir);
      const rightEarTip = add(rightEarBase, mul(rightEarDir, earLength));
      const rightEarP1 = add(rightEarBase, mul(rightEarNormal, earWidth * 0.5));
      const rightEarP2 = add(rightEarBase, mul(rightEarNormal, -earWidth * 0.5));
      this.silhouetteTriangle(rightEarP1, rightEarP2, rightEarTip, appearance.base);

      const rightInnerTip = add(rightEarBase, mul(rightEarDir, earLength * 0.72));
      const rightInnerP1 = add(rightEarBase, mul(rightEarNormal, earWidth * 0.26));
      const rightInnerP2 = add(rightEarBase, mul(rightEarNormal, -earWidth * 0.26));
      this.bodyTriangles.triangle(rightInnerP1, rightInnerTip, rightInnerP2, appearance.accent);
    }

    if (fish.mutation === FishMutation.Umbra) {
      const eclipseCenter = lerp(fish.renderSpine[2], fish.renderSpine[4], 0.5);
      const voidRadius = Math.max(9.5, fish.bodyLength * 0.38);
      const rimRadius = voidRadius + Math.max(0.75, fish.bodyWidth * 0.16);

      // Neon Gold & Lavender Dorsal Crest: illuminates the fish body with radiant solar neon facets
      for (let node = 0; node < 5; node += 1) {
        const p1 = fish.renderSpine[node];
        const p2 = fish.renderSpine[node + 1];
        const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
        const normal = perpendicular(tangent);
        const ridgeWidth = this.widthAt(fish, node) * 0.42;

        const leftRidge = add(p1, mul(normal, ridgeWidth));
        const rightRidge = add(p1, mul(normal, -ridgeWidth));
        const nextLeft = add(p2, mul(normal, ridgeWidth * 0.8));
        const nextRight = add(p2, mul(normal, -ridgeWidth * 0.8));

        // Alternating neon gold and ultraviolet lavender dorsal facets
        const facetColor = node % 2 === 0 ? appearance.accent : appearance.marking;
        this.bodyTriangles.triangle(leftRidge, nextLeft, nextRight, facetColor);
        this.bodyTriangles.triangle(leftRidge, nextRight, rightRidge, facetColor);
      }

      // 6 Orbiting cosmic solar flare plasma particles around the celestial rim
      for (let k = 0; k < 6; k += 1) {
        const particleAngle = fish.swimPhase * 1.5 + k * ((Math.PI * 2) / 6);
        const orbitDist = rimRadius * (1.06 + 0.08 * Math.sin(fish.swimPhase * 2.4 + k));
        const px = eclipseCenter.x + Math.cos(particleAngle) * orbitDist;
        const py = eclipseCenter.y + Math.sin(particleAngle) * orbitDist;
        const particleColor = k % 2 === 0 ? appearance.marking : appearance.accent;
        this.bodyTriangles.circle(
          { x: px, y: py },
          Math.max(0.75, fish.bodyWidth * 0.15),
          particleColor,
          6,
        );
      }
    }

    if (fish.mutation === FishMutation.Midas) {
      this.drawMidasGlimmers(fish, appearance);
    } else if (fish.mutation === FishMutation.Electric) {
      this.drawElectricLightning(fish, appearance);
    } else if (fish.mutation === FishMutation.Frozen) {
      this.drawFrozenIceCube(fish, appearance);
    } else if (fish.mutation === FishMutation.Nuclear) {
      this.drawNuclearRadioactive(fish, appearance);
    } else if (fish.mutation === FishMutation.Mythical) {
      this.drawMythicalChromaticAura(fish, appearance);
    } else if (fish.mutation === FishMutation.RainbowCluster) {
      this.drawRainbowClusterGems(fish, appearance);
    } else if (fish.mutation === FishMutation.Ishmael) {
      this.drawIshmaelFeatures(fish, appearance);
    } else if (fish.mutation === FishMutation.Serene) {
      this.drawSereneWispsAndStars(fish, appearance);
    } else if (fish.mutation === FishMutation.Astraeus) {
      this.drawAstraeusWispsAndStars(fish, appearance);
    }
  }

  private drawMidasGlimmers(fish: Koi, appearance: FishAppearance): void {
    // 1. Shimmering dorsal gold highlight ridge
    for (let node = 1; node < 6; node += 1) {
      const p1 = fish.renderSpine[node];
      const p2 = fish.renderSpine[node + 1];
      const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const ridgeW = this.widthAt(fish, node) * 0.28;
      const l1 = add(p1, mul(normal, ridgeW));
      const r1 = add(p1, mul(normal, -ridgeW));
      const l2 = add(p2, mul(normal, ridgeW * 0.75));
      const r2 = add(p2, mul(normal, -ridgeW * 0.75));
      this.bodyTriangles.triangle(l1, l2, r2, appearance.accent);
      this.bodyTriangles.triangle(l1, r2, r1, appearance.accent);
    }

    // 2. Twinkling 4-pointed specular diamond star glimmers
    const sparkleNodes = [1, 3, 5, 7];
    for (let i = 0; i < sparkleNodes.length; i += 1) {
      const node = sparkleNodes[i];
      const center = fish.renderSpine[node];
      const phase = fish.swimPhase * 3.4 + i * 1.57;
      const intensity = Math.pow(Math.max(0, Math.sin(phase)), 4);
      if (intensity < 0.08) continue;

      const pPrev = fish.renderSpine[Math.max(0, node - 1)];
      const pNext = fish.renderSpine[Math.min(SPINE_NODES - 1, node + 1)];
      const tangent = normalize(sub(pPrev, pNext), fromAngle(fish.heading));
      const normal = perpendicular(tangent);

      const reach = intensity * fish.bodyWidth * 0.95;
      const waist = reach * 0.20;

      const tipTop = add(center, mul(tangent, reach));
      const tipBottom = add(center, mul(tangent, -reach));
      const tipLeft = add(center, mul(normal, reach));
      const tipRight = add(center, mul(normal, -reach));

      const wTopL = add(center, mul(normal, waist));
      const wTopR = add(center, mul(normal, -waist));
      const wSideT = add(center, mul(tangent, waist));
      const wSideB = add(center, mul(tangent, -waist));

      // Specular diamond star flare
      this.bodyTriangles.triangle(tipTop, wTopL, wTopR, appearance.eye);
      this.bodyTriangles.triangle(tipBottom, wTopR, wTopL, appearance.eye);
      this.bodyTriangles.triangle(tipLeft, wSideT, wSideB, appearance.eye);
      this.bodyTriangles.triangle(tipRight, wSideB, wSideT, appearance.eye);
    }
  }

  private drawElectricLightning(fish: Koi, appearance: FishAppearance): void {
    // Crackling zigzag lightning arcs across the dorsal spine
    for (let node = 1; node < 8; node += 1) {
      const p1 = fish.renderSpine[node];
      const p2 = fish.renderSpine[node + 1];
      const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
      const normal = perpendicular(tangent);

      const jitter = Math.sin(fish.swimPhase * 19.0 + node * 7.7) * (Math.cos(node * 4.3) > 0 ? 1 : -1);
      const halfW = this.widthAt(fish, node);
      const mid = lerp(p1, p2, 0.5);
      const boltPoint = add(mid, mul(normal, jitter * halfW * 0.85));

      const boltThickness = Math.max(0.65, fish.bodyWidth * 0.14);
      const bNormal = perpendicular(normalize(sub(p1, boltPoint), normal));
      const p1L = add(p1, mul(bNormal, boltThickness));
      const p1R = add(p1, mul(bNormal, -boltThickness));
      const p2L = add(p2, mul(bNormal, boltThickness * 0.7));
      const p2R = add(p2, mul(bNormal, -boltThickness * 0.7));

      this.bodyTriangles.triangle(p1L, boltPoint, p1R, appearance.accent);
      this.bodyTriangles.triangle(boltPoint, p2L, p2R, appearance.accent);

      // Neon white core in high-voltage segments
      if (Math.abs(jitter) > 0.6) {
        this.bodyTriangles.circle(boltPoint, Math.max(0.6, boltThickness * 0.7), appearance.eye, 5);
      }
    }

    // High frequency spark discharges along lateral perimeter
    for (let s = 0; s < 3; s += 1) {
      const sparkAngle = fish.swimPhase * 14.0 + s * 2.1;
      const sparkDist = fish.bodyWidth * (1.1 + 0.3 * Math.sin(sparkAngle * 2.5));
      const baseNode = 3 + s * 2;
      const center = fish.renderSpine[baseNode];
      const sx = center.x + Math.cos(sparkAngle) * sparkDist;
      const sy = center.y + Math.sin(sparkAngle) * sparkDist;
      this.bodyTriangles.circle({ x: sx, y: sy }, Math.max(0.6, fish.bodyWidth * 0.12), appearance.eye, 4);
    }
  }

  private drawFrozenIceCubeShadow(fish: Koi): void {
    const center = lerp(
      fish.renderSpine[0],
      fish.renderSpine[SPINE_NODES - 1],
      0.5,
    );
    const tangent = fromAngle(fish.heading);
    const normal = perpendicular(tangent);

    const halfL = fish.bodyLength * 0.65;
    const halfW = fish.bodyWidth * 2.1;
    const b = halfW * 0.35;

    const localVerts = [
      { x: halfL, y: halfW - b },
      { x: halfL - b, y: halfW },
      { x: -halfL + b, y: halfW },
      { x: -halfL, y: halfW - b },
      { x: -halfL, y: -halfW + b },
      { x: -halfL + b, y: -halfW },
      { x: halfL - b, y: -halfW },
      { x: halfL, y: -halfW + b },
    ];

    const shadowCenter = add(center, {
      x: FISH.shadow.offset.x + FISH.shadow.depthOffset.x * this.currentVisualDepth,
      y: FISH.shadow.offset.y + FISH.shadow.depthOffset.y * this.currentVisualDepth,
    });

    const sVerts: Vec2[] = [];
    for (let i = 0; i < 8; i += 1) {
      const v = localVerts[i];
      sVerts.push(add(shadowCenter, add(mul(tangent, v.x), mul(normal, v.y))));
    }

    const opacity =
      FISH.shadow.surfaceOpacity +
      (FISH.shadow.deepOpacity - FISH.shadow.surfaceOpacity) *
        this.currentVisualDepth;
    this.shadowStrengthColor.setRGB(opacity * 1.15, opacity * 1.15, opacity * 1.15);

    for (let i = 0; i < 8; i += 1) {
      const next = (i + 1) % 8;
      this.shadowTriangles.triangle(shadowCenter, sVerts[i], sVerts[next], this.shadowStrengthColor);
    }
  }

  private drawFrozenIceCube(fish: Koi, appearance: FishAppearance): void {
    const center = lerp(
      fish.renderSpine[0],
      fish.renderSpine[SPINE_NODES - 1],
      0.5,
    );
    const tangent = fromAngle(fish.heading);
    const normal = perpendicular(tangent);

    const halfL = fish.bodyLength * 0.64;
    const halfW = fish.bodyWidth * 2.05;
    const b = halfW * 0.34;

    const localVerts = [
      { x: halfL, y: halfW - b },
      { x: halfL - b, y: halfW },
      { x: -halfL + b, y: halfW },
      { x: -halfL, y: halfW - b },
      { x: -halfL, y: -halfW + b },
      { x: -halfL + b, y: -halfW },
      { x: halfL - b, y: -halfW },
      { x: halfL, y: -halfW + b },
    ];

    const topVerts: Vec2[] = [];
    for (let i = 0; i < 8; i += 1) {
      const v = localVerts[i];
      topVerts.push(add(center, add(mul(tangent, v.x), mul(normal, v.y))));
    }

    // 3D Extrusion offset for perspective bevel depth
    const extOffset = { x: 1.5, y: 3.2 };
    const btmVerts: Vec2[] = topVerts.map((p) => add(p, extOffset));

    // 1. South-facing 3D extrusion side bevels (darker refraction cyan)
    for (let i = 0; i < 4; i += 1) {
      const next = (i + 1) % 8;
      this.outerTriangles.triangle(topVerts[i], btmVerts[i], btmVerts[next], appearance.marking);
      this.outerTriangles.triangle(topVerts[i], btmVerts[next], topVerts[next], appearance.marking);
    }

    // 2. Translucent top ice face (pale glacial cyan)
    for (let i = 0; i < 8; i += 1) {
      const next = (i + 1) % 8;
      const facetColor = i % 2 === 0 ? appearance.base : appearance.fin;
      this.outerTriangles.triangle(center, topVerts[i], topVerts[next], facetColor);
    }

    // 3. Internal ice fracture cracks (procedural crystal fracture lines inside the ice block)
    const crack1_mid = add(center, add(mul(tangent, halfL * 0.15), mul(normal, -halfW * 0.2)));
    const crack1_j1 = add(crack1_mid, mul(normal, halfW * 0.15));
    this.bodyTriangles.triangle(topVerts[1], crack1_mid, crack1_j1, appearance.eye);
    this.bodyTriangles.triangle(crack1_mid, topVerts[5], crack1_j1, appearance.accent);

    const crack2_mid = add(center, add(mul(tangent, -halfL * 0.2), mul(normal, halfW * 0.25)));
    const crack2_j1 = add(crack2_mid, mul(tangent, halfL * 0.1));
    this.bodyTriangles.triangle(topVerts[7], crack2_mid, crack2_j1, appearance.eye);
    this.bodyTriangles.triangle(crack2_mid, topVerts[3], crack2_j1, appearance.accent);

    // 4. Trapped frozen sub-zero air bubbles inside the ice block
    const bubbleOffsets = [
      { lx: halfL * 0.45, ly: halfW * 0.35, r: 0.18 },
      { lx: halfL * 0.35, ly: -halfW * 0.45, r: 0.14 },
      { lx: -halfL * 0.25, ly: halfW * 0.48, r: 0.16 },
      { lx: -halfL * 0.45, ly: -halfW * 0.32, r: 0.20 },
      { lx: 0, ly: -halfW * 0.52, r: 0.12 },
    ];
    for (const b of bubbleOffsets) {
      const bx = center.x + tangent.x * b.lx + normal.x * b.ly;
      const by = center.y + tangent.y * b.lx + normal.y * b.ly;
      const bRad = Math.max(0.65, fish.bodyWidth * b.r);
      this.bodyTriangles.circle({ x: bx, y: by }, bRad, appearance.eye, 5);
      this.bodyTriangles.circle({ x: bx, y: by }, bRad * 0.5, appearance.marking, 4);
    }

    // 5. Specular highlight gleam along sun-facing top bevel edges
    const gleamIndices = [4, 5, 6, 7];
    for (const i of gleamIndices) {
      const next = (i + 1) % 8;
      const p1 = topVerts[i];
      const p2 = topVerts[next];
      const edgeDir = normalize(sub(p1, p2), tangent);
      const edgeNorm = perpendicular(edgeDir);
      const gw = Math.max(0.65, fish.bodyWidth * 0.10);
      this.bodyTriangles.triangle(
        add(p1, mul(edgeNorm, gw)),
        p2,
        add(p2, mul(edgeNorm, gw)),
        appearance.eye,
      );
      this.bodyTriangles.triangle(
        add(p1, mul(edgeNorm, gw)),
        p1,
        p2,
        appearance.eye,
      );
    }
  }

  private drawNuclearRadioactive(fish: Koi, appearance: FishAppearance): void {
    const coreCenter = lerp(fish.renderSpine[2], fish.renderSpine[4], 0.5);
    const pulse = 0.5 + 0.5 * Math.sin(fish.swimPhase * 4.2);

    // 1. Pulsating toxic nuclear core
    const coreRadius = Math.max(1.2, fish.bodyWidth * (0.42 + 0.16 * pulse));
    this.bodyTriangles.circle(coreCenter, coreRadius, appearance.accent, 10);
    this.bodyTriangles.circle(coreCenter, coreRadius * 0.5, appearance.marking, 8);

    // 2. 5 Orbiting radioactive isotope particles
    const pPrev = fish.renderSpine[1];
    const pNext = fish.renderSpine[5];
    const tangent = normalize(sub(pPrev, pNext), fromAngle(fish.heading));
    const normal = perpendicular(tangent);

    const orbitRx = fish.bodyWidth * 1.65;
    const orbitRy = fish.bodyWidth * 1.15;

    for (let j = 0; j < 5; j += 1) {
      const angle = fish.swimPhase * 2.5 + j * ((Math.PI * 2) / 5);
      const px = coreCenter.x + tangent.x * (Math.cos(angle) * orbitRx) + normal.x * (Math.sin(angle) * orbitRy);
      const py = coreCenter.y + tangent.y * (Math.cos(angle) * orbitRx) + normal.y * (Math.sin(angle) * orbitRy);

      const partRadius = Math.max(0.75, fish.bodyWidth * 0.17);
      this.bodyTriangles.circle({ x: px, y: py }, partRadius, appearance.accent, 6);
      this.bodyTriangles.circle({ x: px, y: py }, partRadius * 0.45, appearance.base, 4);
    }
  }

  private drawMythicalChromaticAura(fish: Koi, appearance: FishAppearance): void {
    // 1. Flowing chromatic dorsal facet spine
    for (let node = 0; node < 6; node += 1) {
      const p1 = fish.renderSpine[node];
      const p2 = fish.renderSpine[node + 1];
      const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const ridgeW = this.widthAt(fish, node) * 0.35;

      const l1 = add(p1, mul(normal, ridgeW));
      const r1 = add(p1, mul(normal, -ridgeW));
      const l2 = add(p2, mul(normal, ridgeW * 0.8));
      const r2 = add(p2, mul(normal, -ridgeW * 0.8));

      const facetColor = node % 2 === 0 ? appearance.accent : appearance.marking;
      this.bodyTriangles.triangle(l1, l2, r2, facetColor);
      this.bodyTriangles.triangle(l1, r2, r1, facetColor);
    }

    // 2. 6 Orbiting chromatic stardust prismatic stars
    const center = fish.renderSpine[3];
    const numStars = 6;
    for (let k = 0; k < numStars; k += 1) {
      const angle = fish.swimPhase * 1.6 + k * ((Math.PI * 2) / numStars);
      const dist = fish.bodyWidth * (1.75 + 0.22 * Math.sin(fish.swimPhase * 3.0 + k));
      const sx = center.x + Math.cos(angle) * dist;
      const sy = center.y + Math.sin(angle) * dist;

      const starReach = Math.max(0.8, fish.bodyWidth * 0.28);
      const waist = starReach * 0.25;
      const starColor = k % 2 === 0 ? appearance.accent : appearance.marking;

      const tTop = { x: sx, y: sy - starReach };
      const tBottom = { x: sx, y: sy + starReach };
      const tLeft = { x: sx - starReach, y: sy };
      const tRight = { x: sx + starReach, y: sy };

      const wL = { x: sx - waist, y: sy };
      const wR = { x: sx + waist, y: sy };
      const wT = { x: sx, y: sy - waist };
      const wB = { x: sx, y: sy + waist };

      this.bodyTriangles.triangle(tTop, wL, wR, starColor);
      this.bodyTriangles.triangle(tBottom, wR, wL, starColor);
      this.bodyTriangles.triangle(tLeft, wT, wB, appearance.eye);
      this.bodyTriangles.triangle(tRight, wB, wT, appearance.eye);
    }
  }

  private drawRainbowClusterGems(fish: Koi, appearance: FishAppearance): void {
    // 7 Clustered undulating pastel crystalline gems
    const clusterNodes = [2, 2, 4, 4, 6, 6, 8];
    const clusterSides = [1, -1, 1, -1, 1, -1, 0];

    for (let j = 0; j < 7; j += 1) {
      const node = clusterNodes[j];
      const side = clusterSides[j];
      const p = fish.renderSpine[node];
      const pNext = fish.renderSpine[Math.min(SPINE_NODES - 1, node + 1)];
      const tangent = normalize(sub(p, pNext), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const halfW = this.widthAt(fish, node);

      const floatPhase = fish.swimPhase * 1.8 + j * 1.05;
      const dist = halfW * (1.35 + 0.20 * Math.sin(floatPhase));
      const tangentShift = Math.cos(floatPhase * 1.3) * halfW * 0.35;

      const gemCenter = add(
        add(p, mul(normal, side * dist)),
        mul(tangent, tangentShift),
      );

      const gemColor = PASTEL_GEM_COLORS[j % PASTEL_GEM_COLORS.length];
      const gemSize = Math.max(0.85, fish.bodyWidth * 0.32);
      const gemW = gemSize * 0.58;

      const top = add(gemCenter, mul(tangent, gemSize));
      const bottom = add(gemCenter, mul(tangent, -gemSize));
      const left = add(gemCenter, mul(normal, gemW));
      const right = add(gemCenter, mul(normal, -gemW));

      // Dual-faceted diamond gem crystal
      this.bodyTriangles.triangle(top, left, bottom, gemColor);
      this.bodyTriangles.triangle(top, bottom, right, appearance.base);
      // Glistening specular core
      this.bodyTriangles.circle(gemCenter, Math.max(0.5, gemSize * 0.25), appearance.eye, 5);
    }
  }

  private drawIshmaelFeatures(fish: Koi, appearance: FishAppearance): void {
    const leatherColor = appearance.marking; // Dark leather brown
    const leatherHighlight = new THREE.Color("#613a20");
    const ribbonWhite = new THREE.Color("#f3f4f6");
    const ribbonShadow = new THREE.Color("#9ca3af");
    const ribbonOutline = new THREE.Color("#374151");
    const irisColor = appearance.eye; // Warm olive-hazel
    const pupilColor = new THREE.Color("#1a1f26");
    const whiteHighlight = new THREE.Color("#ffffff");
    const finAccentColor = appearance.accent; // Deeper burnt orange

    // 1. Leather Dark Brown Hairband (Headband) wrapping across spine nodes 1-2
    const p1 = fish.renderSpine[1];
    const p2 = fish.renderSpine[2];
    const bandCenter = lerp(p1, p2, 0.4);
    const bandTangent = normalize(sub(p1, p2), fromAngle(fish.heading));
    const bandNormal = perpendicular(bandTangent);
    const fishWidth = this.widthAt(fish, 1) * 1.05;
    const bandHalfThickness = Math.max(0.7, fish.bodyLength * 0.045);

    const bandLeftFront = add(add(bandCenter, mul(bandTangent, bandHalfThickness)), mul(bandNormal, fishWidth));
    const bandRightFront = add(add(bandCenter, mul(bandTangent, bandHalfThickness)), mul(bandNormal, -fishWidth));
    const bandLeftBack = add(add(bandCenter, mul(bandTangent, -bandHalfThickness)), mul(bandNormal, fishWidth));
    const bandRightBack = add(add(bandCenter, mul(bandTangent, -bandHalfThickness)), mul(bandNormal, -fishWidth));

    this.bodyTriangles.triangle(bandLeftFront, bandRightFront, bandRightBack, leatherColor);
    this.bodyTriangles.triangle(bandLeftFront, bandRightBack, bandLeftBack, leatherColor);

    // Subtle leather highlight seam along the center of the band
    const seamThickness = bandHalfThickness * 0.35;
    const seamLF = add(add(bandCenter, mul(bandTangent, seamThickness)), mul(bandNormal, fishWidth * 0.85));
    const seamRF = add(add(bandCenter, mul(bandTangent, seamThickness)), mul(bandNormal, -fishWidth * 0.85));
    const seamLB = add(add(bandCenter, mul(bandTangent, -seamThickness)), mul(bandNormal, fishWidth * 0.85));
    const seamRB = add(add(bandCenter, mul(bandTangent, -seamThickness)), mul(bandNormal, -fishWidth * 0.85));
    this.bodyTriangles.triangle(seamLF, seamRF, seamRB, leatherHighlight);
    this.bodyTriangles.triangle(seamLF, seamRB, seamLB, leatherHighlight);

    // 2. Large Anime Cartoon Expressive Eyes
    const headForward = normalize(sub(fish.renderSpine[0], fish.renderSpine[1]), fromAngle(fish.heading));
    const headNormal = perpendicular(headForward);
    const eyeAnchor = add(fish.renderSpine[0], mul(headForward, fish.bodyWidth * 0.08));
    const eyeOffset = this.widthAt(fish, 0) * 0.58;
    const bigEyeRadius = Math.max(1.8, fish.bodyWidth * 0.28);

    for (const side of [1, -1]) {
      const center = add(eyeAnchor, mul(headNormal, eyeOffset * side));
      // Outer dark slate border
      this.bodyTriangles.circle(center, bigEyeRadius, ribbonOutline, 10);
      // Cream/grey sclera ring
      this.bodyTriangles.circle(center, bigEyeRadius * 0.86, ribbonWhite, 9);
      // Hazel-olive amber iris
      this.bodyTriangles.circle(center, bigEyeRadius * 0.68, irisColor, 8);
      // Dark pupil
      this.bodyTriangles.circle(center, bigEyeRadius * 0.38, pupilColor, 6);
      // Crisp white anime specular highlight gleam in upper-right
      const gleamOffset = add(mul(headForward, bigEyeRadius * 0.28), mul(headNormal, bigEyeRadius * 0.25 * side));
      this.bodyTriangles.circle(add(center, gleamOffset), bigEyeRadius * 0.22, whiteHighlight, 5);
      // Secondary subtle gleam dot
      const gleamOffset2 = add(mul(headForward, -bigEyeRadius * 0.18), mul(headNormal, -bigEyeRadius * 0.16 * side));
      this.bodyTriangles.circle(add(center, gleamOffset2), bigEyeRadius * 0.10, whiteHighlight, 4);
    }

    // 3. Iconic Silver/White Hair Ribbon Bow with fluttering swallowtail ties
    const bowScale = Math.max(2.6, fish.bodyWidth * 0.82);
    for (const side of [1, -1]) {
      const sideNormal = mul(bandNormal, side);
      const knotCenter = add(bandCenter, mul(sideNormal, fishWidth * 0.94));

      // Fore loop (pointing forward and slightly outward)
      const foreDir = normalize(add(mul(bandTangent, 0.85), mul(sideNormal, 0.52)), bandTangent);
      const foreNorm = perpendicular(foreDir);
      const foreTip = add(knotCenter, mul(foreDir, bowScale * 1.15));
      const foreP1 = add(add(knotCenter, mul(foreDir, bowScale * 0.85)), mul(foreNorm, bowScale * 0.44));
      const foreP2 = add(add(knotCenter, mul(foreDir, bowScale * 0.85)), mul(foreNorm, -bowScale * 0.44));
      this.bodyTriangles.triangle(knotCenter, foreP1, foreTip, ribbonWhite);
      this.bodyTriangles.triangle(knotCenter, foreTip, foreP2, ribbonWhite);
      // Inner fold crease shadow
      const foreCrease = add(knotCenter, mul(foreDir, bowScale * 0.65));
      this.bodyTriangles.triangle(knotCenter, foreP1, foreCrease, ribbonShadow);

      // Aft loop (pointing backward and slightly outward)
      const aftDir = normalize(add(mul(bandTangent, -0.85), mul(sideNormal, 0.52)), mul(bandTangent, -1));
      const aftNorm = perpendicular(aftDir);
      const aftTip = add(knotCenter, mul(aftDir, bowScale * 1.15));
      const aftP1 = add(add(knotCenter, mul(aftDir, bowScale * 0.85)), mul(aftNorm, bowScale * 0.44));
      const aftP2 = add(add(knotCenter, mul(aftDir, bowScale * 0.85)), mul(aftNorm, -bowScale * 0.44));
      this.bodyTriangles.triangle(knotCenter, aftP1, aftTip, ribbonWhite);
      this.bodyTriangles.triangle(knotCenter, aftTip, aftP2, ribbonWhite);
      // Inner fold crease shadow
      const aftCrease = add(knotCenter, mul(aftDir, bowScale * 0.65));
      this.bodyTriangles.triangle(knotCenter, aftP2, aftCrease, ribbonShadow);

      // Two dangling fluttering ribbon tails trailing along the body
      const sway1 = Math.sin(fish.swimPhase * 1.1 + side * 0.5) * 0.20;
      const sway2 = Math.sin(fish.swimPhase * 1.1 + 0.7 + side * 0.5) * 0.24;

      // Tail 1 (outer tie)
      const t1Dir = normalize(add(mul(bandTangent, -0.92), mul(sideNormal, 0.38 + sway1)), mul(bandTangent, -1));
      const t1Norm = perpendicular(t1Dir);
      const t1Len = bowScale * 1.65;
      const t1W = bowScale * 0.36;
      const t1Tip = add(knotCenter, mul(t1Dir, t1Len));
      const t1L = add(t1Tip, mul(t1Norm, t1W * 0.5));
      const t1R = add(t1Tip, mul(t1Norm, -t1W * 0.5));
      const t1Notch = add(t1Tip, mul(t1Dir, -bowScale * 0.32)); // Swallowtail V-cut
      this.bodyTriangles.triangle(knotCenter, t1L, t1Notch, ribbonWhite);
      this.bodyTriangles.triangle(knotCenter, t1Notch, t1R, ribbonWhite);
      this.bodyTriangles.triangle(knotCenter, t1L, t1R, ribbonShadow);

      // Tail 2 (inner tie)
      const t2Dir = normalize(add(mul(bandTangent, -0.95), mul(sideNormal, 0.20 + sway2)), mul(bandTangent, -1));
      const t2Norm = perpendicular(t2Dir);
      const t2Len = bowScale * 1.40;
      const t2W = bowScale * 0.32;
      const t2Tip = add(knotCenter, mul(t2Dir, t2Len));
      const t2L = add(t2Tip, mul(t2Norm, t2W * 0.5));
      const t2R = add(t2Tip, mul(t2Norm, -t2W * 0.5));
      const t2Notch = add(t2Tip, mul(t2Dir, -bowScale * 0.28)); // Swallowtail V-cut
      this.bodyTriangles.triangle(knotCenter, t2L, t2Notch, ribbonWhite);
      this.bodyTriangles.triangle(knotCenter, t2Notch, t2R, ribbonWhite);

      // Central Knot button
      this.bodyTriangles.circle(knotCenter, bowScale * 0.26, ribbonShadow, 7);
      this.bodyTriangles.circle(knotCenter, bowScale * 0.18, ribbonWhite, 6);
    }

    // 4. Elegant Symmetrical Dorsal Ridge along midline
    for (let node = 2; node < 7; node += 1) {
      const p1 = fish.renderSpine[node];
      const p2 = fish.renderSpine[node + 1];
      const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const ridgeW = this.widthAt(fish, node) * 0.28;
      const nextRidgeW = this.widthAt(fish, node + 1) * 0.28;

      const l1 = add(p1, mul(normal, ridgeW));
      const r1 = add(p1, mul(normal, -ridgeW));
      const l2 = add(p2, mul(normal, nextRidgeW));
      const r2 = add(p2, mul(normal, -nextRidgeW));

      const facetColor = node % 2 === 0 ? finAccentColor : leatherColor;
      this.bodyTriangles.triangle(l1, l2, r2, facetColor);
      this.bodyTriangles.triangle(l1, r2, r1, facetColor);
    }
  }

  private drawEtherealRippleRibbon(
    rootPos: Vec2,
    rootTangent: Vec2,
    rootNormal: Vec2,
    side: number,
    ribbonLength: number,
    baseWidth: number,
    swimPhase: number,
    phaseOffset: number,
    waveAmplitude: number,
    waveFreq: number,
    colorA: THREE.Color,
    colorB: THREE.Color,
    colorTip?: THREE.Color,
    colorCore?: THREE.Color,
    segments: number = 7,
  ): void {
    const ptsL: Vec2[] = [];
    const ptsR: Vec2[] = [];
    const sideNormal = mul(rootNormal, side);

    for (let s = 0; s <= segments; s += 1) {
      const u = s / segments;
      // Gentle spatial wave propagation (sóng gợn nhẹ nhàng)
      const wave = Math.sin(swimPhase * waveFreq - u * 2.6 + phaseOffset);
      const waveDisplace = waveAmplitude * Math.pow(u, 1.25) * wave;
      // Elegant outward arching plume
      const plume = baseWidth * 1.5 * Math.sin(u * Math.PI * 0.65);

      const center = add(
        add(rootPos, mul(rootTangent, -ribbonLength * u)),
        mul(sideNormal, plume + waveDisplace),
      );

      // Width profile: starts soft, swells gracefully in mid-body, tapers to fine gossamer tip
      const w = baseWidth * Math.pow(1 - u, 0.85) * (0.6 + 0.4 * Math.sin(u * Math.PI));
      ptsL[s] = add(center, mul(sideNormal, w * 0.5));
      ptsR[s] = add(center, mul(sideNormal, -w * 0.5));
    }

    // Render smooth quad ribbon strip
    for (let s = 0; s < segments; s += 1) {
      const u = s / segments;
      let segColor = colorA;
      if (colorTip && u >= 0.65) {
        segColor = colorTip;
      } else if (u >= 0.35) {
        segColor = colorB;
      }
      this.bodyTriangles.triangle(ptsL[s], ptsL[s + 1], ptsR[s + 1], segColor);
      this.bodyTriangles.triangle(ptsL[s], ptsR[s + 1], ptsR[s], segColor);

      if (colorCore && s === 1) {
        const midCenter = lerp(ptsL[s], ptsR[s], 0.5);
        this.bodyTriangles.circle(midCenter, Math.max(0.4, baseWidth * 0.26), colorCore, 5);
      }
    }
  }

  private drawCelestialDiamondStar(
    cx: number,
    cy: number,
    starSize: number,
    starWaist: number,
    colorTips: THREE.Color,
    colorSides: THREE.Color,
    colorCore: THREE.Color,
    rotation: number = 0,
  ): void {
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const rot = (x: number, y: number): Vec2 => ({
      x: cx + x * cosR - y * sinR,
      y: cy + x * sinR + y * cosR,
    });

    const tTop = rot(0, -starSize);
    const tBottom = rot(0, starSize);
    const tLeft = rot(-starSize, 0);
    const tRight = rot(starSize, 0);

    const wTL = rot(-starWaist, -starWaist);
    const wTR = rot(starWaist, -starWaist);
    const wBL = rot(-starWaist, starWaist);
    const wBR = rot(starWaist, starWaist);

    this.bodyTriangles.triangle(tTop, wTL, wTR, colorTips);
    this.bodyTriangles.triangle(tBottom, wBR, wBL, colorTips);
    this.bodyTriangles.triangle(tLeft, wBL, wTL, colorSides);
    this.bodyTriangles.triangle(tRight, wTR, wBR, colorSides);
    this.bodyTriangles.circle({ x: cx, y: cy }, Math.max(0.45, starWaist * 0.82), colorCore, 5);
  }

  private drawSereneWispsAndStars(fish: Koi, appearance: FishAppearance): void {
    const cyanColor = appearance.accent; // #00ffe1
    const deepBlue = appearance.marking; // #0284c7
    const skyBlue = appearance.fin;      // #38bdf8
    const starlightWhite = appearance.eye; // #ffffff

    // 1. Serene glowing dorsal veil with gentle undulating crest
    for (let node = 1; node < 7; node += 1) {
      const p1 = fish.renderSpine[node];
      const p2 = fish.renderSpine[node + 1];
      const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const ridgeW = this.widthAt(fish, node) * 0.32;
      const crestWave = Math.sin(fish.swimPhase * 1.15 - node * 0.5) * (ridgeW * 0.25);
      const l1 = add(p1, mul(normal, ridgeW + crestWave));
      const r1 = add(p1, mul(normal, -ridgeW + crestWave));
      const l2 = add(p2, mul(normal, ridgeW * 0.72));
      const r2 = add(p2, mul(normal, -ridgeW * 0.72));
      const ridgeColor = node % 2 === 0 ? cyanColor : skyBlue;
      this.bodyTriangles.triangle(l1, l2, r2, ridgeColor);
      this.bodyTriangles.triangle(l1, r2, r1, ridgeColor);
    }

    // 2. Soft, multi-segment fluid Polaris offshoot ribbons (sóng gợn nhẹ nhàng dọc hai bên sườn)
    const wispNodes = [2, 4, 6];
    for (let i = 0; i < wispNodes.length; i += 1) {
      const node = wispNodes[i];
      const origin = fish.renderSpine[node];
      const nextNode = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(sub(origin, fish.renderSpine[nextNode]), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const localWidth = this.widthAt(fish, node);

      for (const side of [1, -1]) {
        const sideNormal = mul(normal, side);
        const startPoint = add(origin, mul(sideNormal, localWidth * 0.82));
        const wispLen = fish.bodyLength * (0.48 + i * 0.10);
        const baseWidth = Math.max(0.7, fish.bodyWidth * 0.22);
        const waveAmp = fish.bodyWidth * 0.25;

        this.drawEtherealRippleRibbon(
          startPoint,
          tangent,
          normal,
          side,
          wispLen,
          baseWidth,
          fish.swimPhase,
          i * 1.15 + (side > 0 ? 0 : 0.8),
          waveAmp,
          1.15, // Serene slow wave frequency
          cyanColor,
          skyBlue,
          deepBlue,
          starlightWhite,
          7,
        );
      }
    }

    // 3. Orbiting Polaris 4-pointed celestial diamond stars (gentle, calming orbit)
    const numStars = 4;
    const center = lerp(fish.renderSpine[2], fish.renderSpine[5], 0.5);
    for (let s = 0; s < numStars; s += 1) {
      const orbitAngle = fish.swimPhase * 0.75 + s * ((Math.PI * 2) / numStars);
      const orbitRx = fish.bodyWidth * 1.55;
      const orbitRy = fish.bodyWidth * 1.15;
      const sx = center.x + Math.cos(orbitAngle) * orbitRx;
      const sy = center.y + Math.sin(orbitAngle) * orbitRy;

      const twinkle = 0.70 + 0.30 * Math.sin(fish.swimPhase * 1.8 + s * 1.4);
      const starSize = Math.max(0.75, fish.bodyWidth * 0.28 * twinkle);
      const starWaist = starSize * 0.26;
      const rotation = fish.swimPhase * 0.5 + s;

      this.drawCelestialDiamondStar(
        sx,
        sy,
        starSize,
        starWaist,
        cyanColor,
        skyBlue,
        starlightWhite,
        rotation,
      );
    }

    // 4. Luminous drifting Polaris stardust motes (trailing behind in the slipstream)
    for (let m = 0; m < 3; m += 1) {
      const motePhase = fish.swimPhase * 1.1 + m * 2.1;
      const trailNode = 6 + m * 2;
      const p = fish.renderSpine[Math.min(SPINE_NODES - 1, trailNode)];
      const driftX = Math.cos(motePhase) * (fish.bodyWidth * 0.35);
      const driftY = Math.sin(motePhase * 1.2) * (fish.bodyWidth * 0.35);
      const moteCenter = { x: p.x + driftX, y: p.y + driftY };
      const motePulse = 0.5 + 0.5 * Math.sin(motePhase * 1.5);
      this.bodyTriangles.circle(moteCenter, Math.max(0.45, fish.bodyWidth * 0.08 * motePulse), cyanColor, 4);
    }
  }

  private drawAstraeusWispsAndStars(fish: Koi, appearance: FishAppearance): void {
    const violetColor = appearance.marking; // #c084fc Ultraviolet twilight violet
    const orangeColor = appearance.accent;  // #ff8c00 Fiery dusk solar orange
    const deepPurple = appearance.fin;      // #9333ea Royal cosmic purple
    const starlightCore = appearance.eye;   // #ffedd5 Solar golden starlight core

    // 1. Cosmic twilight dual-tone dorsal veil (alternating violet and dusk orange with ripple wave)
    for (let node = 1; node < 7; node += 1) {
      const p1 = fish.renderSpine[node];
      const p2 = fish.renderSpine[node + 1];
      const tangent = normalize(sub(p1, p2), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const ridgeW = this.widthAt(fish, node) * 0.34;
      const crestWave = Math.sin(fish.swimPhase * 1.20 - node * 0.5) * (ridgeW * 0.25);
      const l1 = add(p1, mul(normal, ridgeW + crestWave));
      const r1 = add(p1, mul(normal, -ridgeW + crestWave));
      const l2 = add(p2, mul(normal, ridgeW * 0.72));
      const r2 = add(p2, mul(normal, -ridgeW * 0.72));
      const facetColor = node % 2 === 0 ? violetColor : orangeColor;
      this.bodyTriangles.triangle(l1, l2, r2, facetColor);
      this.bodyTriangles.triangle(l1, r2, r1, facetColor);
    }

    // 2. Dual-tone swirling purple and solar dusk-orange fluid offshoot ribbons
    const wispNodes = [1, 3, 5, 7];
    for (let i = 0; i < wispNodes.length; i += 1) {
      const node = wispNodes[i];
      const origin = fish.renderSpine[node];
      const nextNode = Math.min(SPINE_NODES - 1, node + 1);
      const tangent = normalize(sub(origin, fish.renderSpine[nextNode]), fromAngle(fish.heading));
      const normal = perpendicular(tangent);
      const localWidth = this.widthAt(fish, node);

      for (const side of [1, -1]) {
        const sideNormal = mul(normal, side);
        const startPoint = add(origin, mul(sideNormal, localWidth * 0.85));
        const wispLen = fish.bodyLength * (0.45 + i * 0.09);
        const baseWidth = Math.max(0.72, fish.bodyWidth * 0.24);
        const waveAmp = fish.bodyWidth * 0.28;

        const isOrange = (i + (side > 0 ? 0 : 1)) % 2 === 0;
        const colorA = isOrange ? orangeColor : violetColor;
        const colorB = isOrange ? violetColor : orangeColor;

        this.drawEtherealRippleRibbon(
          startPoint,
          tangent,
          normal,
          side,
          wispLen,
          baseWidth,
          fish.swimPhase,
          i * 1.18 + (side > 0 ? 0 : 0.85),
          waveAmp,
          1.20, // Astraeus gentle cosmic wave frequency
          colorA,
          colorB,
          deepPurple,
          starlightCore,
          7,
        );
      }
    }

    // 3. Orbiting dual-tone twilight diamond stars (purple & dusk-orange constellation)
    const numStars = 5;
    const center = lerp(fish.renderSpine[2], fish.renderSpine[5], 0.5);
    for (let s = 0; s < numStars; s += 1) {
      const orbitAngle = fish.swimPhase * 0.80 + s * ((Math.PI * 2) / numStars);
      const orbitRx = fish.bodyWidth * 1.60;
      const orbitRy = fish.bodyWidth * 1.20;
      const sx = center.x + Math.cos(orbitAngle) * orbitRx;
      const sy = center.y + Math.sin(orbitAngle) * orbitRy;

      const twinkle = 0.70 + 0.30 * Math.sin(fish.swimPhase * 1.9 + s * 1.3);
      const starSize = Math.max(0.8, fish.bodyWidth * 0.30 * twinkle);
      const starWaist = starSize * 0.26;
      const rotation = fish.swimPhase * 0.55 + s;

      const isStarOrange = s % 2 === 0;
      const starPrimary = isStarOrange ? orangeColor : violetColor;
      const starSecondary = isStarOrange ? violetColor : orangeColor;

      this.drawCelestialDiamondStar(
        sx,
        sy,
        starSize,
        starWaist,
        starPrimary,
        starSecondary,
        starlightCore,
        rotation,
      );
    }

    // 4. Luminous drifting solar plasma stardust motes
    for (let m = 0; m < 4; m += 1) {
      const motePhase = fish.swimPhase * 1.15 + m * 1.8;
      const trailNode = 5 + m * 2;
      const p = fish.renderSpine[Math.min(SPINE_NODES - 1, trailNode)];
      const driftX = Math.cos(motePhase) * (fish.bodyWidth * 0.38);
      const driftY = Math.sin(motePhase * 1.25) * (fish.bodyWidth * 0.38);
      const moteCenter = { x: p.x + driftX, y: p.y + driftY };
      const moteColor = m % 2 === 0 ? orangeColor : violetColor;
      const motePulse = 0.5 + 0.5 * Math.sin(motePhase * 1.6);
      this.bodyTriangles.circle(moteCenter, Math.max(0.45, fish.bodyWidth * 0.08 * motePulse), moteColor, 4);
    }
  }

  private drawDebug(fish: Koi, appearance: FishAppearance): void {
    for (let node = 0; node < SPINE_NODES - 1; node += 1) {
      this.outlineLines.line(
        fish.renderSpine[node],
        fish.renderSpine[node + 1],
        appearance.eye,
      );
    }
  }
}
