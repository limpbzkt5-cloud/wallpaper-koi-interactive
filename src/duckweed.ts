import * as THREE from "three";
import {
  DUCKWEED,
  DUCKWEED_PATCHES,
  MAX_DUCKWEED_PATCHES,
  MAX_RIPPLE_TYPES,
  RIPPLES,
  viewportPoint,
} from "./config";
import {
  buildDuckweedBuffers,
  DUCKWEED_RIPPLE_PEAK_SCALE,
  type DuckweedLayerBuffers,
  type DuckweedLeafShape,
} from "./duckweed-geometry";
import {
  RIPPLE_TYPE_ORDER,
  type RippleInstance,
  type RippleSystem,
  type RippleType,
} from "./ripple-system";

const MAX_DUCKWEED_RIPPLES = 32;
// When more ripples are alive than fit in the uniform array, keep these first.
const RIPPLE_PRIORITY: readonly RippleType[] = ["touch", "mouth", "rain"];

// The vertex transform below is mirrored by duckweedVertexWorld and
// duckweedRippleDisplacement in duckweed-geometry.ts. Keep in sync.
const DECLARATIONS = /* glsl */ `
  #define DUCKWEED_MAX_PATCHES ${MAX_DUCKWEED_PATCHES}
  #define DUCKWEED_MAX_RIPPLES ${MAX_DUCKWEED_RIPPLES}
  #define DUCKWEED_RIPPLE_TYPES ${MAX_RIPPLE_TYPES}
  attribute float patchIndex;
  attribute vec2 leafCenter;
  attribute float leafSign;
  uniform vec4 uPatches[DUCKWEED_MAX_PATCHES];
  uniform int uRippleCount;
  uniform vec4 uRipples[DUCKWEED_MAX_RIPPLES];
  uniform float uRippleStrength[DUCKWEED_MAX_RIPPLES];
  uniform vec4 uTypePhysics[DUCKWEED_RIPPLE_TYPES];
  uniform float uStrength;
  uniform float uBandWidth;
  uniform float uFalloffDistance;
  uniform float uMaxPush;
  uniform float uSpin;

  vec2 duckweedRotate(vec2 point, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(point.x * c - point.y * s, point.x * s + point.y * c);
  }
`;

function transformChunk(shadow: boolean): string {
  return /* glsl */ `
    vec4 dwPatch = uPatches[int(patchIndex + 0.5)];
    vec2 dwWorld = dwPatch.xy + duckweedRotate(position.xy, dwPatch.z);
    if (uRippleCount > 0) {
      vec2 dwLeaf = dwPatch.xy + duckweedRotate(leafCenter, dwPatch.z);
      vec2 dwPush = vec2(0.0);
      float dwSpin = 0.0;
      float dwWidth = max(uBandWidth, 0.001);
      float dwFalloffDistance = max(uFalloffDistance, 0.001);
      for (int i = 0; i < DUCKWEED_MAX_RIPPLES; i++) {
        if (i >= uRippleCount) break;
        vec4 ripple = uRipples[i];
        vec4 physics = uTypePhysics[int(ripple.w + 0.5)];
        vec2 delta = dwLeaf - ripple.xy;
        float d = length(delta);
        vec2 dir = d > 0.001 ? delta / d : vec2(0.0);
        float front = physics.y + physics.z * ripple.z;
        float x = d - front;
        float env = exp(-(x * x) / (dwWidth * dwWidth));
        float remaining = clamp(1.0 - ripple.z / max(physics.x, 0.0001), 0.0, 1.0);
        float fade = remaining * remaining;
        float falloff = 1.0 / (1.0 + d / dwFalloffDistance);
        float amp = uStrength * uRippleStrength[i] * fade * falloff;
        dwPush += dir * amp * env * (x / dwWidth) * ${DUCKWEED_RIPPLE_PEAK_SCALE.toFixed(2)};
        dwSpin += amp * env * uSpin;
      }
      float dwPushLength = length(dwPush);
      if (dwPushLength > uMaxPush) dwPush *= uMaxPush / dwPushLength;
      dwWorld = dwLeaf + duckweedRotate(dwWorld - dwLeaf, dwSpin * leafSign) + dwPush;
    }
    ${shadow ? "dwWorld += uShadowOffset;" : ""}
    vec3 transformed = vec3(dwWorld, position.z);
  `;
}

// Injects the patch/ripple vertex transform into a MeshBasicMaterial. The
// meshes stay at the origin (identity model matrix), so `transformed` is the
// world position and color-space/output handling stay stock.
function injectDuckweedTransform(
  material: THREE.MeshBasicMaterial,
  uniforms: Record<string, THREE.IUniform>,
  shadowOffset: THREE.IUniform<THREE.Vector2> | null,
): void {
  const shadow = shadowOffset !== null;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (shadowOffset) shader.uniforms.uShadowOffset = shadowOffset;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${DECLARATIONS}${shadow ? "uniform vec2 uShadowOffset;" : ""}`,
      )
      .replace("#include <begin_vertex>", transformChunk(shadow));
  };
  material.customProgramCacheKey = () =>
    shadow ? "duckweed-shadow" : "duckweed-leaf";
}

interface DuckweedPalette {
  base: THREE.Color;
  light: THREE.Color;
  shade: THREE.Color;
  center: THREE.Color;
}

const PALETTES: readonly DuckweedPalette[] = DUCKWEED.palettes.map((palette) => ({
  base: new THREE.Color(palette.base),
  light: new THREE.Color(palette.light),
  shade: new THREE.Color(palette.shade),
  center: new THREE.Color(palette.center),
}));

function randomUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createLayerGeometry(
  buffers: DuckweedLayerBuffers,
  name: string,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 3));
  geometry.setAttribute("leafCenter", new THREE.BufferAttribute(buffers.leafCenters, 2));
  geometry.setAttribute("leafSign", new THREE.BufferAttribute(buffers.leafSigns, 1));
  geometry.setAttribute("patchIndex", new THREE.BufferAttribute(buffers.patchIndices, 1));
  geometry.name = name;
  return geometry;
}

export class DuckweedPass {
  public readonly shadowGroup = new THREE.Group();
  public readonly group = new THREE.Group();

  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: DUCKWEED.shadow.color,
    opacity: DUCKWEED.shadow.opacity,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly leafMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  // Shared by the leaf, highlight, and shadow materials.
  private readonly patchData = Array.from(
    { length: MAX_DUCKWEED_PATCHES },
    () => new THREE.Vector4(),
  );
  private readonly rippleData = Array.from(
    { length: MAX_DUCKWEED_RIPPLES },
    () => new THREE.Vector4(),
  );
  private readonly rippleStrength = new Float32Array(MAX_DUCKWEED_RIPPLES);
  private readonly typePhysics = Array.from(
    { length: MAX_RIPPLE_TYPES },
    () => new THREE.Vector4(1, 0, 0, 0),
  );
  private readonly uniforms = {
    uPatches: { value: this.patchData },
    uRippleCount: { value: 0 },
    uRipples: { value: this.rippleData },
    uRippleStrength: { value: this.rippleStrength },
    uTypePhysics: { value: this.typePhysics },
    uStrength: { value: 0 },
    uBandWidth: { value: 1 },
    uFalloffDistance: { value: 1 },
    uMaxPush: { value: 0 },
    uSpin: { value: 0 },
  };
  private readonly shadowOffset = { value: new THREE.Vector2() };
  private readonly typeWeights: number[] = Array.from(
    { length: MAX_RIPPLE_TYPES },
    () => 0,
  );

  private leafGeometry: THREE.BufferGeometry | null = null;
  private highlightGeometry: THREE.BufferGeometry | null = null;
  private leafMesh: THREE.Mesh | null = null;
  private shadowMesh: THREE.Mesh | null = null;
  private highlightMesh: THREE.Mesh | null = null;
  // Per-patch first-vertex offsets (length patches + 1) for the draw ranges.
  private leafOffsets: number[] = [0];
  private highlightOffsets: number[] = [0];
  private patchCount = 0;

  public constructor() {
    injectDuckweedTransform(this.leafMaterial, this.uniforms, null);
    injectDuckweedTransform(this.shadowMaterial, this.uniforms, this.shadowOffset);
    this.refreshConfig();
  }

  public refreshConfig(): void {
    this.shadowMaterial.color.setHex(DUCKWEED.shadow.color);
    this.shadowMaterial.opacity = DUCKWEED.shadow.opacity;
    for (const [index, palette] of DUCKWEED.palettes.entries()) {
      const target = PALETTES[index];
      if (!target) continue;
      target.base.setHex(palette.base);
      target.light.setHex(palette.light);
      target.shade.setHex(palette.shade);
      target.center.setHex(palette.center);
    }
    this.rebuild();
  }

  public update(
    time: number,
    ripples?: RippleSystem | readonly RippleInstance[],
  ): void {
    if (DUCKWEED_PATCHES.length !== this.patchCount) this.rebuild();

    const visiblePatchCount = Math.min(
      DUCKWEED.visiblePatchCount,
      DUCKWEED_PATCHES.length,
      MAX_DUCKWEED_PATCHES,
    );
    // Patches are contiguous, so visibility is a prefix of both buffers.
    this.leafGeometry?.setDrawRange(0, this.leafOffsets[visiblePatchCount] ?? 0);
    this.highlightGeometry?.setDrawRange(
      0,
      this.highlightOffsets[visiblePatchCount] ?? 0,
    );
    this.shadowOffset.value.set(DUCKWEED.shadow.offset.x, DUCKWEED.shadow.offset.y);

    for (let patchIndex = 0; patchIndex < visiblePatchCount; patchIndex += 1) {
      const patch = DUCKWEED_PATCHES[patchIndex];
      const driftX = Math.sin(time * 0.1 + patch.phase) * DUCKWEED.driftX;
      const driftY =
        Math.cos(time * 0.13 + patch.phase * 1.4) * DUCKWEED.driftY;
      const rotation =
        Math.sin(time * 0.075 + patch.phase) * DUCKWEED.rotationAmount;
      const placement = viewportPoint(patch.x, patch.y);
      this.patchData[patchIndex].set(
        placement.x + driftX,
        placement.y + driftY,
        rotation,
        0,
      );
    }

    this.updateRipples(ripples);
  }

  private updateRipples(
    source: RippleSystem | readonly RippleInstance[] | undefined,
  ): void {
    const response = DUCKWEED.rippleResponse;
    const uniforms = this.uniforms;
    uniforms.uRippleCount.value = 0;
    if (!response.enabled || !source) return;
    const ripples = "instances" in source ? source.instances : source;

    uniforms.uStrength.value = response.strength;
    uniforms.uBandWidth.value = response.bandWidth;
    uniforms.uFalloffDistance.value = response.falloffDistance;
    uniforms.uMaxPush.value = response.maxPush;
    uniforms.uSpin.value = response.spin;
    for (const [typeIndex, type] of RIPPLE_TYPE_ORDER.entries()) {
      if (typeIndex >= MAX_RIPPLE_TYPES) break;
      const profile = RIPPLES.types[type];
      this.typePhysics[typeIndex].set(
        profile.lifetime,
        profile.startRadius,
        profile.expansionSpeed,
        0,
      );
      this.typeWeights[typeIndex] =
        type === "touch"
          ? response.touchWeight
          : type === "mouth"
            ? response.mouthWeight
            : response.rainWeight;
    }

    // Highest-priority types first, so overflow drops rain before touch.
    let count = 0;
    for (const type of RIPPLE_PRIORITY) {
      const typeIndex = RIPPLE_TYPE_ORDER.indexOf(type);
      if (typeIndex < 0 || typeIndex >= MAX_RIPPLE_TYPES) continue;
      const weight = this.typeWeights[typeIndex];
      if (weight <= 0) continue;
      for (const ripple of ripples) {
        if (count >= MAX_DUCKWEED_RIPPLES) break;
        if (!ripple.alive || ripple.age < 0 || ripple.type !== type) continue;
        this.rippleData[count].set(
          ripple.center.x,
          ripple.center.y,
          ripple.age,
          typeIndex,
        );
        this.rippleStrength[count] = ripple.strength * weight;
        count += 1;
      }
    }
    uniforms.uRippleCount.value = count;
  }

  private rebuild(): void {
    this.disposeMeshes();

    const leavesByPatch = this.createLeaves();
    const patchCount = Math.min(DUCKWEED_PATCHES.length, MAX_DUCKWEED_PATCHES);
    const buffers = buildDuckweedBuffers(
      DUCKWEED_PATCHES.slice(0, patchCount).map((patch, patchIndex) => ({
        leaves: leavesByPatch[patchIndex],
        palette: PALETTES[patch.palette % PALETTES.length],
      })),
      DUCKWEED.verticalScale,
    );
    const leafGeometry = createLayerGeometry(buffers.leaf, "duckweed leaves");
    const highlightGeometry = createLayerGeometry(
      buffers.highlight,
      "duckweed highlights",
    );

    const leafMesh = new THREE.Mesh(leafGeometry, this.leafMaterial);
    // The shadow shares the leaf geometry (and its draw range); its material
    // ignores vertex colors.
    const shadowMesh = new THREE.Mesh(leafGeometry, this.shadowMaterial);
    const highlightMesh = new THREE.Mesh(highlightGeometry, this.leafMaterial);
    leafMesh.frustumCulled = false;
    shadowMesh.frustumCulled = false;
    highlightMesh.frustumCulled = false;
    leafMesh.renderOrder = 0;
    shadowMesh.renderOrder = 0;
    highlightMesh.renderOrder = 1;
    this.group.add(leafMesh, highlightMesh);
    this.shadowGroup.add(shadowMesh);

    this.leafGeometry = leafGeometry;
    this.highlightGeometry = highlightGeometry;
    this.leafMesh = leafMesh;
    this.shadowMesh = shadowMesh;
    this.highlightMesh = highlightMesh;
    this.leafOffsets = buffers.leaf.patchVertexOffsets;
    this.highlightOffsets = buffers.highlight.patchVertexOffsets;
    // Compared against the live collection length by update().
    this.patchCount = DUCKWEED_PATCHES.length;
  }

  private disposeMeshes(): void {
    if (this.leafMesh && this.highlightMesh) {
      this.group.remove(this.leafMesh, this.highlightMesh);
    }
    if (this.shadowMesh) this.shadowGroup.remove(this.shadowMesh);
    this.leafGeometry?.dispose();
    this.highlightGeometry?.dispose();
    this.leafGeometry = null;
    this.highlightGeometry = null;
    this.leafMesh = null;
    this.shadowMesh = null;
    this.highlightMesh = null;
    this.leafOffsets = [0];
    this.highlightOffsets = [0];
    this.patchCount = 0;
  }

  private createLeaves(): DuckweedLeafShape[][] {
    const leavesByPatch: DuckweedLeafShape[][] = [];
    for (const [patchIndex, patch] of DUCKWEED_PATCHES.entries()) {
      const leaves: DuckweedLeafShape[] = [];
      for (let index = 0; index < patch.count; index += 1) {
        const seed = patchIndex * 1013 + index * 37 + 11;
        const radiusAmount = Math.pow(
          randomUnit(seed + 1),
          DUCKWEED.spreadExponent,
        );
        const distance = patch.radius * radiusAmount;
        const angle = randomUnit(seed + 2) * Math.PI * 2;
        leaves.push({
          offsetX: Math.cos(angle) * distance,
          offsetY: Math.sin(angle) * distance * 0.74,
          radius:
            DUCKWEED.minimumLeafRadius +
            randomUnit(seed + 3) *
              (DUCKWEED.maximumLeafRadius - DUCKWEED.minimumLeafRadius),
          angle: randomUnit(seed + 4) * Math.PI * 2,
          tone: randomUnit(seed + 6),
          paired: randomUnit(seed + 7) < DUCKWEED.pairChance,
          spinSign: randomUnit(seed + 8) < 0.5 ? -1 : 1,
        });
      }
      leavesByPatch.push(leaves);
    }
    return leavesByPatch;
  }
}
