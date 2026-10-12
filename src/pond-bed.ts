import * as THREE from "three";
import { CANVAS_HEIGHT, CANVAS_WIDTH, POND_BED } from "./config";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uResolution;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSpeckColor;
  uniform float uVerticalTone;
  uniform float uGrainScale;
  uniform float uEdgeDarkening;
  varying vec2 vUv;

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  void main() {
    float verticalTone = smoothstep(0.0, 1.0, vUv.y) * uVerticalTone;
    vec3 color = mix(uDeepColor, uShallowColor, verticalTone);

    vec2 grainCell = floor(
      vUv * uResolution * uGrainScale
    );
    float grain = hash21(grainCell);
    float darkSpeck = smoothstep(0.975, 0.998, grain);
    color -= darkSpeck * uSpeckColor;

    float edgeDepth = smoothstep(0.48, 0.82, length((vUv - 0.5) * vec2(1.0, 1.25)));
    color *= 1.0 - edgeDepth * uEdgeDarkening;

    gl_FragColor = vec4(color, 1.0);
  }
`;

interface RuntimePondBedAppearance {
  deepColor: THREE.Color;
  shallowColor: THREE.Color;
  speckColor: THREE.Color;
  verticalTone: number;
  grainScale: number;
  edgeDarkening: number;
}

function pondBedAppearanceFromConfig(): RuntimePondBedAppearance {
  return {
    deepColor: new THREE.Color().setRGB(...POND_BED.deepColor),
    shallowColor: new THREE.Color().setRGB(...POND_BED.shallowColor),
    speckColor: new THREE.Color().setRGB(...POND_BED.speckColor),
    verticalTone: POND_BED.verticalTone,
    grainScale: POND_BED.grainScale,
    edgeDarkening: POND_BED.edgeDarkening,
  };
}

export class PondBedPass {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  private readonly material: THREE.ShaderMaterial;
  private readonly currentAppearance = pondBedAppearanceFromConfig();
  private targetAppearance = pondBedAppearanceFromConfig();
  private previousTime = -1;

  public constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT) },
        uDeepColor: { value: new THREE.Color() },
        uShallowColor: { value: new THREE.Color() },
        uSpeckColor: { value: new THREE.Color() },
        uVerticalTone: { value: 0 },
        uGrainScale: { value: 0 },
        uEdgeDarkening: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CANVAS_WIDTH, CANVAS_HEIGHT),
      this.material,
    );
    this.mesh.position.set(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5, -1);
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    this.applyUniforms();
  }

  public refreshConfig(): void {
    this.targetAppearance = pondBedAppearanceFromConfig();
  }

  public resize(width: number, height: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height);
    this.mesh.position.set(width * 0.5, height * 0.5, -1);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  public update(time: number): void {
    if (this.previousTime >= 0) {
      const deltaTime = Math.min(0.1, Math.max(0, time - this.previousTime));
      const blend = 1 - Math.exp(-deltaTime * 2.25);
      const current = this.currentAppearance;
      const target = this.targetAppearance;
      current.deepColor.lerp(target.deepColor, blend);
      current.shallowColor.lerp(target.shallowColor, blend);
      current.speckColor.lerp(target.speckColor, blend);
      current.verticalTone +=
        (target.verticalTone - current.verticalTone) * blend;
      current.grainScale += (target.grainScale - current.grainScale) * blend;
      current.edgeDarkening +=
        (target.edgeDarkening - current.edgeDarkening) * blend;
    }
    this.previousTime = time;
    this.applyUniforms();
  }

  private applyUniforms(): void {
    const current = this.currentAppearance;
    this.material.uniforms.uDeepColor.value.copy(current.deepColor);
    this.material.uniforms.uShallowColor.value.copy(current.shallowColor);
    this.material.uniforms.uSpeckColor.value.copy(current.speckColor);
    this.material.uniforms.uVerticalTone.value = current.verticalTone;
    this.material.uniforms.uGrainScale.value = current.grainScale;
    this.material.uniforms.uEdgeDarkening.value = current.edgeDarkening;
  }
}
