import * as THREE from "three";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  MAX_FISH,
} from "./config";
import { clamp } from "./math";
import type { School } from "./school";

const vertexHeader = /* glsl */ `
  precision highp float;
  uniform vec2 uResolution;

  vec4 pondPosition(vec2 point) {
    vec2 clip = vec2(
      point.x / uResolution.x * 2.0 - 1.0,
      1.0 - point.y / uResolution.y * 2.0
    );
    return vec4(clip, 0.0, 1.0);
  }
`;

const depthVertexShader = /* glsl */ `
  ${vertexHeader}
  attribute vec2 aCenter;
  attribute vec2 aDirection;
  attribute vec2 aSize;
  attribute vec2 aDepth;
  varying vec2 vLocal;
  varying vec2 vForward;
  varying vec2 vDepth;

  void main() {
    vec2 normal = vec2(-aDirection.y, aDirection.x);
    vec2 point =
      aCenter
      + aDirection * position.x * aSize.x
      + normal * position.y * aSize.y;
    vLocal = position.xy;
    vForward = aDirection;
    vDepth = aDepth;
    gl_Position = pondPosition(point);
  }
`;

const depthFragmentShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uStrength;
  uniform float uWaveFrequency;
  uniform float uWaveSpeed;
  varying vec2 vLocal;
  varying vec2 vForward;
  varying vec2 vDepth;

  void main() {
    float radiusSquared = dot(vLocal, vLocal);
    float mask =
      exp(-radiusSquared * 2.35)
      * (1.0 - smoothstep(0.82, 1.06, radiusSquared));
    vec2 normal = vec2(-vForward.y, vForward.x);
    float phase = vDepth.y + uTime * uWaveSpeed;
    float waveA = sin(
      (vLocal.x * 0.82 + vLocal.y * 0.31) * uWaveFrequency + phase
    );
    float waveB = cos(
      (vLocal.y * 0.91 - vLocal.x * 0.24) * (uWaveFrequency * 0.73)
      - phase * 1.17
    );
    vec2 displacement =
      (normal * waveA + vForward * waveB * 0.62)
      * mask
      * vDepth.x
      * uStrength;
    gl_FragColor = vec4(displacement, 0.0, 1.0);
  }
`;

function quadGeometry(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, -1, 0,
        1, 1, 0,
        -1, 1, 0,
      ],
      3,
    ),
  );
  geometry.instanceCount = 0;
  return geometry;
}

function instanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  name: string,
  array: Float32Array,
  itemSize: number,
): THREE.InstancedBufferAttribute {
  const attribute = new THREE.InstancedBufferAttribute(array, itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

function dynamicMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export class SurfaceDisturbancePass {
  public readonly texture: THREE.Texture;

  private readonly target = new THREE.WebGLRenderTarget(
    Math.ceil(CANVAS_WIDTH * 0.5),
    Math.ceil(CANVAS_HEIGHT * 0.5),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    },
  );
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly depthGeometry = quadGeometry();
  private readonly depthCenters = new Float32Array(MAX_FISH * 2);
  private readonly depthDirections = new Float32Array(MAX_FISH * 2);
  private readonly depthSizes = new Float32Array(MAX_FISH * 2);
  private readonly depthValues = new Float32Array(MAX_FISH * 2);
  private readonly depthAttributes: THREE.InstancedBufferAttribute[];
  private readonly depthMaterial: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();

  public constructor() {
    this.texture = this.target.texture;
    this.texture.generateMipmaps = false;
    this.texture.name = "koi surface disturbances";

    this.depthAttributes = [
      instanceAttribute(this.depthGeometry, "aCenter", this.depthCenters, 2),
      instanceAttribute(this.depthGeometry, "aDirection", this.depthDirections, 2),
      instanceAttribute(this.depthGeometry, "aSize", this.depthSizes, 2),
      instanceAttribute(this.depthGeometry, "aDepth", this.depthValues, 2),
    ];

    this.depthMaterial = dynamicMaterial(depthVertexShader, depthFragmentShader, {
      uResolution: { value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT) },
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uWaveFrequency: { value: 0 },
      uWaveSpeed: { value: 0 },
    });
    const depthMesh = new THREE.Mesh(this.depthGeometry, this.depthMaterial);
    depthMesh.frustumCulled = false;
    this.scene.add(depthMesh);
  }

  public render(
    renderer: THREE.WebGLRenderer,
    school: School,
    time: number,
    previewFishIndex: number | null = null,
  ): void {
    this.updateDepthInstances(school, previewFishIndex);
    this.depthMaterial.uniforms.uTime.value = time;
    this.depthMaterial.uniforms.uStrength.value = FISH.depth.localDistortion.strength;
    this.depthMaterial.uniforms.uWaveFrequency.value =
      FISH.depth.localDistortion.waveFrequency;
    this.depthMaterial.uniforms.uWaveSpeed.value = FISH.depth.localDistortion.waveSpeed;

    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this.clearColor, clearAlpha);
  }

  public resize(width: number, height: number): void {
    this.target.setSize(Math.ceil(width * 0.5), Math.ceil(height * 0.5));
    this.depthMaterial.uniforms.uResolution.value.set(width, height);
  }

  public dispose(): void {
    this.target.dispose();
    this.depthGeometry.dispose();
    this.depthMaterial.dispose();
  }

  private updateDepthInstances(school: School, previewFishIndex: number | null): void {
    let count = 0;
    const depthRange = Math.max(FISH.depth.visualEnd - FISH.depth.visualStart, 0.001);
    for (let index = 0; index < school.count && count < MAX_FISH; index += 1) {
      if (previewFishIndex !== null && index !== previewFishIndex) continue;
      const fish = school.fish[index];
      const visualDepth = clamp(
        (fish.depth - FISH.depth.visualStart) / depthRange,
        0,
        1,
      );
      const smoothDepth = visualDepth * visualDepth * (3 - 2 * visualDepth);
      if (smoothDepth <= 0.005) continue;
      const offset = count * 2;
      this.depthCenters[offset] = previewFishIndex === null ? fish.position.x : CANVAS_WIDTH * 0.5;
      this.depthCenters[offset + 1] = previewFishIndex === null ? fish.position.y : CANVAS_HEIGHT * 0.5;
      this.depthDirections[offset] = Math.cos(fish.heading);
      this.depthDirections[offset + 1] = Math.sin(fish.heading);
      this.depthSizes[offset] =
        fish.bodyLength * FISH.depth.localDistortion.lengthScale * (previewFishIndex === null ? 1 : 1.6);
      this.depthSizes[offset + 1] =
        fish.bodyWidth * FISH.depth.localDistortion.widthScale * (previewFishIndex === null ? 1 : 1.6);
      this.depthValues[offset] = smoothDepth;
      this.depthValues[offset + 1] = fish.phaseOffset;
      count += 1;
    }
    this.depthGeometry.instanceCount = count;
    for (const attribute of this.depthAttributes) attribute.needsUpdate = true;
  }
}
