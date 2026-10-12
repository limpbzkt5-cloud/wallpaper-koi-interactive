import * as THREE from "three";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_RIPPLES,
  MAX_RIPPLE_TYPES,
  RIPPLES,
  WATER,
} from "./config";
import { RIPPLE_TYPE_ORDER } from "./ripple-system";
import { School } from "./school";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function rippleProfileSelection(uniformName: string): string {
  return Array.from(
    { length: Math.max(0, MAX_RIPPLE_TYPES - 1) },
    (_, offset) => {
      const index = offset + 1;
      return `if (typeIndex > ${index - 0.5}) profile = ${uniformName}[${index}];`;
    },
  ).join("\n    ");
}

const fragmentShader = /* glsl */ `
  precision highp float;

  #define MAX_RIPPLES ${MAX_RIPPLES}
  #define MAX_RIPPLE_TYPES ${MAX_RIPPLE_TYPES}

  uniform sampler2D uUnderwater;
  uniform sampler2D uDisturbance;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uRippleCount;
  uniform vec4 uRipples[MAX_RIPPLES];
  uniform vec4 uRipplePhysics[MAX_RIPPLE_TYPES];
  uniform vec4 uRippleCurves[MAX_RIPPLE_TYPES];
  uniform vec3 uColorTint;
  uniform float uClarity;
  uniform float uShowCurrentEffect;
  uniform float uLargeCellSize;
  uniform float uLargeCurrentOpacity;
  uniform float uSecondaryLargeCellSize;
  uniform float uSecondaryLargeCurrentOpacity;
  uniform float uDetailCellSize;
  uniform float uDetailCurrentOpacity;
  uniform vec3 uLargeCurrentColor;
  uniform vec3 uLargeCurrentCoreColor;
  uniform vec3 uSecondaryLargeCurrentColor;
  uniform vec3 uSecondaryLargeCurrentCoreColor;
  uniform vec3 uDetailCurrentColor;
  uniform vec3 uDetailCurrentCoreColor;
  uniform float uCurrentAmplitude;
  uniform vec2 uWaveDirectionA;
  uniform vec2 uWaveDirectionB;
  uniform vec2 uWaveDirectionC;
  uniform vec3 uWaveFrequency;
  uniform vec3 uWaveSpeed;
  uniform vec3 uWaveStrength;
  uniform float uLargeCurrentTime;
  uniform float uSecondaryLargeCurrentTime;
  uniform float uDetailCurrentTime;
  varying vec2 vUv;

  vec4 ripplePhysics(float typeIndex) {
    vec4 profile = uRipplePhysics[0];
    ${rippleProfileSelection("uRipplePhysics")}
    return profile;
  }

  vec4 rippleCurves(float typeIndex) {
    vec4 profile = uRippleCurves[0];
    ${rippleProfileSelection("uRippleCurves")}
    return profile;
  }

  vec2 hash22(vec2 point) {
    vec2 value = vec2(
      dot(point, vec2(127.1, 311.7)),
      dot(point, vec2(269.5, 183.3))
    );
    return fract(sin(value) * 43758.5453);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);

    float bottomLeft = hash22(cell).x;
    float bottomRight = hash22(cell + vec2(1.0, 0.0)).x;
    float topLeft = hash22(cell + vec2(0.0, 1.0)).x;
    float topRight = hash22(cell + vec2(1.0, 1.0)).x;
    return mix(
      mix(bottomLeft, bottomRight, local.x),
      mix(topLeft, topRight, local.x),
      local.y
    );
  }

  vec2 warpWater(vec2 pixel) {
    float warpX = valueNoise(pixel * 0.010);
    float warpY = valueNoise(pixel * 0.012 + vec2(19.4, 7.8));
    float smallWarpX = valueNoise(
      pixel * 0.022 + vec2(31.8, -12.1)
    );
    float smallWarpY = valueNoise(
      pixel * 0.019 + vec2(-8.2, 26.6)
    );

    vec2 broadBend = vec2(
      sin(pixel.y * 0.025 + warpY * 5.2),
      cos(pixel.x * 0.022 + warpX * 5.6)
    );
    vec2 smallBend = vec2(
      sin((pixel.x + pixel.y) * 0.034 + smallWarpY * 4.8),
      cos((pixel.x - pixel.y) * 0.030 + smallWarpX * 5.1)
    );
    return pixel
      + (vec2(warpX, warpY) - 0.5) * 48.0
      + (vec2(smallWarpX, smallWarpY) - 0.5) * 18.0
      + broadBend * 11.0
      + smallBend * 4.5;
  }

  float cellularBorderDistance(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    float nearest = 10.0;
    float secondNearest = 10.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbour = vec2(float(x), float(y));
        vec2 seed = hash22(cell + neighbour);
        vec2 animatedPoint = 0.5 + 0.32 * sin(6.2831853 * seed);
        vec2 pointDelta = neighbour + animatedPoint - local;
        float influence = mix(
          0.68,
          1.38,
          hash22(cell + neighbour + vec2(41.7, 13.2)).x
        );
        float distanceToPoint = length(pointDelta) / influence;
        if (distanceToPoint < nearest) {
          secondNearest = nearest;
          nearest = distanceToPoint;
        } else if (distanceToPoint < secondNearest) {
          secondNearest = distanceToPoint;
        }
      }
    }

    return secondNearest - nearest;
  }

  vec2 directionalWavePixel(vec2 pixel, vec2 resolution, float time) {
    float aspect = resolution.x / resolution.y;
    vec2 centered = (pixel / resolution - 0.5) * vec2(aspect, 1.0);

    float phaseA =
      dot(centered, uWaveDirectionA)
      * uWaveFrequency.x
      - time * uWaveSpeed.x;
    float phaseB =
      dot(centered, uWaveDirectionB)
      * uWaveFrequency.y
      - time * uWaveSpeed.y;
    float phaseC =
      dot(centered, uWaveDirectionC)
      * uWaveFrequency.z
      - time * uWaveSpeed.z;

    vec2 slope =
      uWaveDirectionA
      * sin(phaseA)
      * uWaveStrength.x
      + uWaveDirectionB
      * sin(phaseB)
      * uWaveStrength.y
      + uWaveDirectionC
      * sin(phaseC)
      * uWaveStrength.z;
    vec2 uvOffset =
      slope
      * vec2(1.0 / aspect, 1.0)
      * uCurrentAmplitude;
    return pixel + uvOffset * resolution;
  }

  void main() {
    vec2 pixel = vec2(vUv.x * uResolution.x, (1.0 - vUv.y) * uResolution.y);
    vec2 displacement = vec2(
      sin(pixel.y * 0.051 + uTime * 0.31) + sin(pixel.y * 0.017 - uTime * 0.19),
      cos(pixel.x * 0.043 - uTime * 0.23) + sin(pixel.x * 0.014 + uTime * 0.16)
    ) * 0.13 / uResolution;

    for (int index = 0; index < MAX_RIPPLES; index++) {
      if (index >= uRippleCount) break;

      vec4 ripple = uRipples[index];
      float typeIndex = floor(ripple.w * 0.5);
      float strength = mod(ripple.w, 2.0);
      vec4 physics = ripplePhysics(typeIndex);
      vec4 curves = rippleCurves(typeIndex);
      vec2 delta = pixel - ripple.xy;
      float distanceToCenter = length(delta);
      vec2 radial = delta / max(distanceToCenter, 0.001);
      float radius =
        physics.y
        + ripple.z * physics.z;
      float signedDistance = distanceToCenter - radius;
      float fade = 1.0 - smoothstep(
        physics.x * curves.y,
        physics.x,
        ripple.z
      );
      float life = clamp(ripple.z / max(physics.x, 0.001), 0.0, 1.0);
      float distortionBand =
        exp(-abs(signedDistance) * curves.x)
        * fade
        * strength
        * (1.0 - life * curves.z);
      float direction = signedDistance < 0.0 ? -1.0 : 1.0;

      displacement +=
        vec2(radial.x, -radial.y)
        * direction
        * distortionBand
        * physics.w
        / uResolution;
    }

    vec2 localDisturbance = texture2D(uDisturbance, vUv).xy;
    displacement +=
      vec2(localDisturbance.x, -localDisturbance.y) / uResolution;

    vec2 sampleUv = clamp(vUv + displacement, vec2(0.002), vec2(0.998));
    vec3 color = texture2D(uUnderwater, sampleUv).rgb;

    vec2 distortedPixel = vec2(
      sampleUv.x * uResolution.x,
      (1.0 - sampleUv.y) * uResolution.y
    );

    color *= uColorTint;

    if (uShowCurrentEffect > 0.5) {
      vec2 largeWavePixel = directionalWavePixel(
        distortedPixel,
        uResolution,
        uLargeCurrentTime
      );
      vec2 warpedPixel = warpWater(largeWavePixel);
      vec2 secondaryLargeWavePixel = directionalWavePixel(
        distortedPixel,
        uResolution,
        uSecondaryLargeCurrentTime
      );
      vec2 detailWavePixel = directionalWavePixel(
        distortedPixel,
        uResolution,
        uDetailCurrentTime
      );
      vec2 secondaryLargePixel =
        warpedPixel + secondaryLargeWavePixel - largeWavePixel;
      vec2 detailPixel = warpedPixel + detailWavePixel - largeWavePixel;

      float largeBorder = cellularBorderDistance(
        warpedPixel / max(uLargeCellSize, 0.001)
      );
      float largeWidthNoise = valueNoise(warpedPixel * 0.018 + vec2(3.7, 11.2));
      float largeVein = 1.0 - smoothstep(
        0.032 + largeWidthNoise * 0.010,
        0.125 + largeWidthNoise * 0.022,
        largeBorder
      );
      float largeCore = 1.0 - smoothstep(0.010, 0.052, largeBorder);

      float secondaryLargeBorder = cellularBorderDistance(
        secondaryLargePixel / max(uSecondaryLargeCellSize, 0.001)
        + vec2(5.2, 8.4)
      );
      float secondaryLargeWidthNoise = valueNoise(
        secondaryLargePixel * 0.015 + vec2(17.6, -6.8)
      );
      float secondaryLargeVein = 1.0 - smoothstep(
        0.032 + secondaryLargeWidthNoise * 0.010,
        0.125 + secondaryLargeWidthNoise * 0.022,
        secondaryLargeBorder
      );
      float secondaryLargeCore =
        1.0 - smoothstep(0.010, 0.052, secondaryLargeBorder);

      float detailBorder = cellularBorderDistance(
        detailPixel / max(uDetailCellSize, 0.001) + vec2(9.6, 4.3)
      );
      float detailRegion = smoothstep(
        0.48,
        0.75,
        valueNoise(detailPixel * 0.008 + vec2(-5.1, 17.8))
      );
      float detailVein =
        (1.0 - smoothstep(0.030, 0.105, detailBorder)) * detailRegion;
      float detailCore =
        (1.0 - smoothstep(0.008, 0.043, detailBorder)) * detailRegion;

      color +=
        (largeVein * uLargeCurrentColor + largeCore * uLargeCurrentCoreColor)
        * uLargeCurrentOpacity * (1.0 - uClarity);
      color +=
        (
          secondaryLargeVein * uSecondaryLargeCurrentColor
          + secondaryLargeCore * uSecondaryLargeCurrentCoreColor
        ) * uSecondaryLargeCurrentOpacity * (1.0 - uClarity);
      color +=
        (detailVein * uDetailCurrentColor + detailCore * uDetailCurrentCoreColor)
        * uDetailCurrentOpacity * (1.0 - uClarity);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

const currentLayerNames = ["large", "secondaryLarge", "detail"] as const;
type CurrentLayerName = (typeof currentLayerNames)[number];

interface RuntimeWaterAppearance {
  colorTint: THREE.Color;
  clarity: number;
  largeCurrentColor: THREE.Color;
  largeCurrentCoreColor: THREE.Color;
  largeCellSize: number;
  largeCurrentOpacity: number;
  largeCurrentSpeed: number;
  secondaryLargeCurrentColor: THREE.Color;
  secondaryLargeCurrentCoreColor: THREE.Color;
  secondaryLargeCellSize: number;
  secondaryLargeCurrentOpacity: number;
  secondaryLargeCurrentSpeed: number;
  detailCurrentColor: THREE.Color;
  detailCurrentCoreColor: THREE.Color;
  detailCellSize: number;
  detailCurrentOpacity: number;
  detailCurrentSpeed: number;
}

function waterAppearanceFromConfig(): RuntimeWaterAppearance {
  return {
    colorTint: new THREE.Color().setRGB(...WATER.colorTint),
    clarity: WATER.clarity,
    largeCurrentColor: new THREE.Color().setRGB(...WATER.largeCurrentColor),
    largeCurrentCoreColor: new THREE.Color().setRGB(
      ...WATER.largeCurrentCoreColor,
    ),
    largeCellSize: WATER.largeCellSize,
    largeCurrentOpacity: WATER.largeCurrentOpacity,
    largeCurrentSpeed: WATER.largeCurrentSpeed,
    secondaryLargeCurrentColor: new THREE.Color().setRGB(
      ...WATER.secondaryLargeCurrentColor,
    ),
    secondaryLargeCurrentCoreColor: new THREE.Color().setRGB(
      ...WATER.secondaryLargeCurrentCoreColor,
    ),
    secondaryLargeCellSize: WATER.secondaryLargeCellSize,
    secondaryLargeCurrentOpacity: WATER.secondaryLargeCurrentOpacity,
    secondaryLargeCurrentSpeed: WATER.secondaryLargeCurrentSpeed,
    detailCurrentColor: new THREE.Color().setRGB(...WATER.detailCurrentColor),
    detailCurrentCoreColor: new THREE.Color().setRGB(
      ...WATER.detailCurrentCoreColor,
    ),
    detailCellSize: WATER.detailCellSize,
    detailCurrentOpacity: WATER.detailCurrentOpacity,
    detailCurrentSpeed: WATER.detailCurrentSpeed,
  };
}

export class WaterSurfacePass {
  public readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  private readonly material: THREE.ShaderMaterial;
  private readonly rippleData = Array.from(
    { length: MAX_RIPPLES },
    () => new THREE.Vector4(),
  );
  private readonly ripplePhysics = Array.from(
    { length: MAX_RIPPLE_TYPES },
    () => new THREE.Vector4(1, 0, 0, 0),
  );
  private readonly rippleCurves = Array.from(
    { length: MAX_RIPPLE_TYPES },
    () => new THREE.Vector4(1, 0, 0, 0),
  );
  private readonly currentAppearance = waterAppearanceFromConfig();
  private targetAppearance = waterAppearanceFromConfig();
  private readonly currentTimes: Record<CurrentLayerName, number> = {
    large: 0,
    secondaryLarge: 0,
    detail: 0,
  };
  private previousTime = -1;

  public constructor(
    underwaterTexture: THREE.Texture,
    disturbanceTexture: THREE.Texture,
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uUnderwater: { value: underwaterTexture },
        uDisturbance: { value: disturbanceTexture },
        uResolution: { value: new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT) },
        uTime: { value: 0 },
        uRippleCount: { value: 0 },
        uRipples: { value: this.rippleData },
        uRipplePhysics: { value: this.ripplePhysics },
        uRippleCurves: { value: this.rippleCurves },
        uColorTint: { value: new THREE.Color() },
        uClarity: { value: WATER.clarity },
        uShowCurrentEffect: { value: 0 },
        uLargeCellSize: { value: 0 },
        uLargeCurrentOpacity: { value: 0 },
        uSecondaryLargeCellSize: { value: 0 },
        uSecondaryLargeCurrentOpacity: { value: 0 },
        uDetailCellSize: { value: 0 },
        uDetailCurrentOpacity: { value: 0 },
        uLargeCurrentColor: { value: new THREE.Color() },
        uLargeCurrentCoreColor: { value: new THREE.Color() },
        uSecondaryLargeCurrentColor: { value: new THREE.Color() },
        uSecondaryLargeCurrentCoreColor: { value: new THREE.Color() },
        uDetailCurrentColor: { value: new THREE.Color() },
        uDetailCurrentCoreColor: { value: new THREE.Color() },
        uCurrentAmplitude: { value: 0 },
        uWaveDirectionA: { value: new THREE.Vector2() },
        uWaveDirectionB: { value: new THREE.Vector2() },
        uWaveDirectionC: { value: new THREE.Vector2() },
        uWaveFrequency: { value: new THREE.Vector3() },
        uWaveSpeed: { value: new THREE.Vector3() },
        uWaveStrength: { value: new THREE.Vector3() },
        uLargeCurrentTime: { value: 0 },
        uSecondaryLargeCurrentTime: { value: 0 },
        uDetailCurrentTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
  }

  public resize(width: number, height: number): void {
    this.material.uniforms.uResolution.value.set(width, height);
  }

  public refreshConfig(): void {
    this.targetAppearance = waterAppearanceFromConfig();
  }

  public update(school: School, time: number): void {
    this.updateCurrentAppearance(time);
    for (let index = 0; index < MAX_RIPPLE_TYPES; index += 1) {
      this.ripplePhysics[index].set(1, 0, 0, 0);
      this.rippleCurves[index].set(1, 0, 0, 0);
    }
    for (
      let index = 0;
      index < Math.min(RIPPLE_TYPE_ORDER.length, MAX_RIPPLE_TYPES);
      index += 1
    ) {
      const profile = RIPPLES.types[RIPPLE_TYPE_ORDER[index]];
      this.ripplePhysics[index].set(
        Math.max(profile.lifetime, 0.001),
        profile.startRadius,
        profile.expansionSpeed,
        profile.distortion,
      );
      this.rippleCurves[index].set(
        profile.bandSharpness,
        profile.fadeStart,
        profile.strengthDecay,
        0,
      );
    }

    let activeCount = 0;
    for (const ripple of school.ripples.instances) {
      if (
        !ripple.alive ||
        ripple.age < 0 ||
        activeCount >= MAX_RIPPLES
      ) {
        continue;
      }
      const typeIndex = RIPPLE_TYPE_ORDER.indexOf(ripple.type);
      if (typeIndex < 0 || typeIndex >= MAX_RIPPLE_TYPES) continue;
      const encodedTypeAndStrength =
        typeIndex * 2 + Math.min(1.999, Math.max(0, ripple.strength));
      this.rippleData[activeCount].set(
        ripple.center.x,
        ripple.center.y,
        ripple.age,
        encodedTypeAndStrength,
      );
      activeCount += 1;
    }
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uRippleCount.value = activeCount;
    this.material.uniforms.uColorTint.value.copy(
      this.currentAppearance.colorTint,
    );
    this.material.uniforms.uClarity.value = this.currentAppearance.clarity;
    this.material.uniforms.uShowCurrentEffect.value = WATER.showCurrentEffect ? 1 : 0;
    this.material.uniforms.uLargeCellSize.value =
      this.currentAppearance.largeCellSize;
    this.material.uniforms.uLargeCurrentOpacity.value =
      this.currentAppearance.largeCurrentOpacity;
    this.material.uniforms.uSecondaryLargeCellSize.value =
      this.currentAppearance.secondaryLargeCellSize;
    this.material.uniforms.uSecondaryLargeCurrentOpacity.value =
      this.currentAppearance.secondaryLargeCurrentOpacity;
    this.material.uniforms.uDetailCellSize.value =
      this.currentAppearance.detailCellSize;
    this.material.uniforms.uDetailCurrentOpacity.value =
      this.currentAppearance.detailCurrentOpacity;
    this.material.uniforms.uLargeCurrentColor.value.copy(
      this.currentAppearance.largeCurrentColor,
    );
    this.material.uniforms.uLargeCurrentCoreColor.value.copy(
      this.currentAppearance.largeCurrentCoreColor,
    );
    this.material.uniforms.uSecondaryLargeCurrentColor.value.copy(
      this.currentAppearance.secondaryLargeCurrentColor,
    );
    this.material.uniforms.uSecondaryLargeCurrentCoreColor.value.copy(
      this.currentAppearance.secondaryLargeCurrentCoreColor,
    );
    this.material.uniforms.uDetailCurrentColor.value.copy(
      this.currentAppearance.detailCurrentColor,
    );
    this.material.uniforms.uDetailCurrentCoreColor.value.copy(
      this.currentAppearance.detailCurrentCoreColor,
    );
    const [waveA, waveB, waveC] = WATER.currentDistortion.waves;
    this.material.uniforms.uCurrentAmplitude.value =
      WATER.currentDistortion.amplitude;
    this.material.uniforms.uWaveDirectionA.value.set(...waveA.direction);
    this.material.uniforms.uWaveDirectionB.value.set(...waveB.direction);
    this.material.uniforms.uWaveDirectionC.value.set(...waveC.direction);
    this.material.uniforms.uWaveFrequency.value.set(
      waveA.frequency,
      waveB.frequency,
      waveC.frequency,
    );
    this.material.uniforms.uWaveSpeed.value.set(
      waveA.speed,
      waveB.speed,
      waveC.speed,
    );
    this.material.uniforms.uWaveStrength.value.set(
      waveA.strength,
      waveB.strength,
      waveC.strength,
    );
    this.material.uniforms.uLargeCurrentTime.value = this.currentTimes.large;
    this.material.uniforms.uSecondaryLargeCurrentTime.value =
      this.currentTimes.secondaryLarge;
    this.material.uniforms.uDetailCurrentTime.value = this.currentTimes.detail;
  }

  private updateCurrentAppearance(time: number): void {
    if (this.previousTime < 0) {
      for (const name of currentLayerNames) this.currentTimes[name] = time;
      this.previousTime = time;
      return;
    }

    const deltaTime = Math.min(0.1, Math.max(0, time - this.previousTime));
    this.previousTime = time;
    const blend = 1 - Math.exp(-deltaTime * 2.25);
    const current = this.currentAppearance;
    const target = this.targetAppearance;
    current.colorTint.lerp(target.colorTint, blend);
    current.clarity += (target.clarity - current.clarity) * blend;
    current.largeCurrentColor.lerp(target.largeCurrentColor, blend);
    current.largeCurrentCoreColor.lerp(target.largeCurrentCoreColor, blend);
    current.secondaryLargeCurrentColor.lerp(
      target.secondaryLargeCurrentColor,
      blend,
    );
    current.secondaryLargeCurrentCoreColor.lerp(
      target.secondaryLargeCurrentCoreColor,
      blend,
    );
    current.detailCurrentColor.lerp(target.detailCurrentColor, blend);
    current.detailCurrentCoreColor.lerp(target.detailCurrentCoreColor, blend);
    current.largeCellSize +=
      (target.largeCellSize - current.largeCellSize) * blend;
    current.largeCurrentOpacity +=
      (target.largeCurrentOpacity - current.largeCurrentOpacity) * blend;
    current.largeCurrentSpeed +=
      (target.largeCurrentSpeed - current.largeCurrentSpeed) * blend;
    current.secondaryLargeCellSize +=
      (target.secondaryLargeCellSize - current.secondaryLargeCellSize) * blend;
    current.secondaryLargeCurrentOpacity +=
      (target.secondaryLargeCurrentOpacity -
        current.secondaryLargeCurrentOpacity) * blend;
    current.secondaryLargeCurrentSpeed +=
      (target.secondaryLargeCurrentSpeed - current.secondaryLargeCurrentSpeed) *
      blend;
    current.detailCellSize +=
      (target.detailCellSize - current.detailCellSize) * blend;
    current.detailCurrentOpacity +=
      (target.detailCurrentOpacity - current.detailCurrentOpacity) * blend;
    current.detailCurrentSpeed +=
      (target.detailCurrentSpeed - current.detailCurrentSpeed) * blend;

    this.currentTimes.large += deltaTime * current.largeCurrentSpeed;
    this.currentTimes.secondaryLarge +=
      deltaTime * current.secondaryLargeCurrentSpeed;
    this.currentTimes.detail += deltaTime * current.detailCurrentSpeed;
  }
}
