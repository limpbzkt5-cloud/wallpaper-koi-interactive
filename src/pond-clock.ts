import * as THREE from "three";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./config";
import type { WeatherPresetId } from "./weather";
import type { RippleSystem } from "./ripple-system";

export type ClockMode = "off" | "submerged" | "floating";
export type ClockFormat = "24h" | "12h";
export type ClockPosition = "center" | "top-right" | "top-left" | "bottom-center";

export interface ClockOptions {
  enabled: boolean;
  mode: ClockMode;
  format: ClockFormat;
  showSeconds: boolean;
  opacity: number;
  position: ClockPosition;
}

export const DEFAULT_CLOCK_OPTIONS: ClockOptions = {
  enabled: true,
  mode: "submerged",
  format: "24h",
  showSeconds: false,
  opacity: 0.45,
  position: "center",
};

const MAX_CLOCK_RIPPLES = 24;

const clockVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorldPos;
  uniform vec2 uClockPos;
  uniform vec2 uClockSize;

  void main() {
    vUv = uv;
    // Map UVs across the clock quad plane into world space relative to clock center
    vWorldPos = uClockPos + (uv - 0.5) * uClockSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const clockFragmentShader = /* glsl */ `
  precision highp float;

  #define MAX_CLOCK_RIPPLES 24

  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uCausticColor;
  uniform vec2 uClockPos;
  uniform vec2 uClockSize;
  uniform vec4 uRipples[MAX_CLOCK_RIPPLES];
  uniform int uRippleCount;

  varying vec2 vUv;
  varying vec2 vWorldPos;

  void main() {
    // 1. Natural fluid harmonic stream undulation
    vec2 flowOffset = vec2(
      sin(vUv.y * 14.0 + uTime * 1.85) * 0.012 + sin((vUv.x + vUv.y) * 22.0 - uTime * 1.35) * 0.007,
      cos(vUv.x * 12.0 - uTime * 1.60) * 0.010 + cos((vUv.x - vUv.y) * 18.0 + uTime * 1.20) * 0.006
    );

    // 2. Interactive ripple wave deformation from passing koi ripples
    vec2 rippleOffset = vec2(0.0);
    for (int i = 0; i < MAX_CLOCK_RIPPLES; i++) {
      if (i >= uRippleCount) break;
      vec4 rip = uRipples[i]; // xy = center, z = age, w = strength
      float age = rip.z;
      float strength = rip.w;
      float radius = 12.0 + age * 88.0;
      vec2 delta = vWorldPos - rip.xy;
      float dist = length(delta);
      float signedDist = dist - radius;
      float waveBand = exp(-abs(signedDist) * 0.20) * clamp(1.0 - age / 3.0, 0.0, 1.0) * strength;
      vec2 radialDir = delta / max(dist, 0.001);
      rippleOffset += radialDir * waveBand * 0.024;
    }

    vec2 finalUv = clamp(vUv + flowOffset + rippleOffset, vec2(0.001), vec2(0.999));
    vec4 texColor = texture2D(uTexture, finalUv);

    if (texColor.a <= 0.005) {
      discard;
    }

    // 3. Dynamic traveling caustic light ribbon network
    float c1 = sin(vWorldPos.x * 0.075 + vWorldPos.y * 0.048 + uTime * 2.10);
    float c2 = cos(vWorldPos.x * 0.058 - vWorldPos.y * 0.065 - uTime * 1.75);
    float c3 = sin((vWorldPos.x + vWorldPos.y) * 0.110 - uTime * 2.50);
    float causticIntensity = pow(clamp(0.5 + 0.5 * (c1 * c2 + c3), 0.0, 1.0), 3.0);

    // Highlight glyph core while preserving drop shadow contrast
    float glyphCore = smoothstep(0.35, 0.85, texColor.a);
    vec3 outColor = texColor.rgb + uCausticColor * (causticIntensity * 0.42 * glyphCore);

    // Subtle edge rim shimmer
    float edgeGlow = (1.0 - smoothstep(0.15, 0.70, texColor.a)) * 0.20 * glyphCore;
    outColor += uCausticColor * edgeGlow;

    gl_FragColor = vec4(outColor, texColor.a * uOpacity);
  }
`;

function getCausticColorForWeather(weather: WeatherPresetId): THREE.Color {
  switch (weather) {
    case "moonlight":
      return new THREE.Color(0.65, 0.95, 0.99);
    case "sunset":
      return new THREE.Color(1.0, 0.88, 0.72);
    case "mist":
    case "overcast":
      return new THREE.Color(0.88, 0.92, 0.96);
    case "rain":
      return new THREE.Color(0.82, 0.90, 1.0);
    case "deep-clear":
      return new THREE.Color(0.70, 0.92, 1.0);
    case "sunny":
    default:
      return new THREE.Color(0.95, 0.98, 1.0);
  }
}

function createOffscreenCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    return { canvas, ctx };
  }
  const mockCtx = {
    clearRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 100 }),
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D;
  const mockCanvas = {
    width,
    height,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;
  return { canvas: mockCanvas, ctx: mockCtx };
}

export class PondClock {
  public options: ClockOptions;
  public readonly mesh: THREE.Mesh;
  public readonly basePosition = new THREE.Vector2(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.48);

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly ripplesUniform: THREE.Vector4[];

  private lastRenderedKey = "";
  private lastWeatherId: WeatherPresetId | null = null;

  public constructor(options: Partial<ClockOptions> = {}) {
    this.options = { ...DEFAULT_CLOCK_OPTIONS, ...options };

    const { canvas, ctx } = createOffscreenCanvas(1024, 512);
    this.canvas = canvas;
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    // Plane geometry scaled x1.5 in virtual canvas units (270 x 135 in 480x270 aspect space)
    const planeW = 270;
    const planeH = 135;
    const geometry = new THREE.PlaneGeometry(planeW, planeH);

    this.ripplesUniform = Array.from(
      { length: MAX_CLOCK_RIPPLES },
      () => new THREE.Vector4(0, 0, 0, 0),
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: this.texture },
        uTime: { value: 0 },
        uOpacity: { value: this.options.opacity },
        uCausticColor: { value: getCausticColorForWeather("sunny") },
        uClockPos: { value: new THREE.Vector2(this.basePosition.x, this.basePosition.y) },
        uClockSize: { value: new THREE.Vector2(planeW, planeH) },
        uRipples: { value: this.ripplesUniform },
        uRippleCount: { value: 0 },
      },
      vertexShader: clockVertexShader,
      fragmentShader: clockFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.material.opacity = this.options.opacity;

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;

    // Invert Y axis because camera coordinate system has top = 0 and bottom = CANVAS_HEIGHT (Y increases downwards)
    this.mesh.scale.set(1, -1, 1);

    this.updatePosition();
    this.renderCanvas(new Date(), "sunny");
  }

  public setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
    this.mesh.visible = enabled;
  }

  public setMode(mode: ClockMode): void {
    this.options.mode = mode;
    if (mode === "off") {
      this.setEnabled(false);
    } else {
      this.setEnabled(true);
    }
  }

  public setFormat(format: ClockFormat): void {
    this.options.format = format;
    this.forceRedraw();
  }

  public setShowSeconds(show: boolean): void {
    this.options.showSeconds = show;
    this.forceRedraw();
  }

  public setOpacity(opacity: number): void {
    this.options.opacity = Math.max(0.05, Math.min(1.0, opacity));
    this.material.opacity = this.options.opacity;
    this.material.uniforms.uOpacity.value = this.options.opacity;
  }

  public setPosition(position: ClockPosition): void {
    this.options.position = position;
    this.updatePosition();
  }

  public updatePosition(): void {
    switch (this.options.position) {
      case "center":
        this.basePosition.set(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.48);
        break;
      case "top-right":
        this.basePosition.set(CANVAS_WIDTH * 0.74, CANVAS_HEIGHT * 0.22);
        break;
      case "top-left":
        this.basePosition.set(CANVAS_WIDTH * 0.26, CANVAS_HEIGHT * 0.22);
        break;
      case "bottom-center":
        this.basePosition.set(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.80);
        break;
    }
    this.mesh.position.set(this.basePosition.x, this.basePosition.y, 0);
    this.material.uniforms.uClockPos.value.copy(this.basePosition);
  }

  public forceRedraw(): void {
    this.lastRenderedKey = "";
  }

  public update(
    now: Date,
    weather: WeatherPresetId,
    time: number = 0,
    ripples: RippleSystem | null = null,
  ): void {
    if (!this.options.enabled) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // Organic buoyancy wave drift
    if (time > 0) {
      const bobX = Math.sin(time * 0.85) * 1.6;
      const bobY = Math.cos(time * 0.65) * 1.2;
      this.mesh.position.set(this.basePosition.x + bobX, this.basePosition.y + bobY, 0);
      this.material.uniforms.uClockPos.value.set(this.mesh.position.x, this.mesh.position.y);
    } else {
      this.mesh.position.set(this.basePosition.x, this.basePosition.y, 0);
      this.material.uniforms.uClockPos.value.copy(this.basePosition);
    }

    this.material.uniforms.uTime.value = time;

    // Synchronize active water ripple wave packets
    if (ripples && ripples.instances) {
      let activeCount = 0;
      for (let i = 0; i < ripples.instances.length; i++) {
        const rip = ripples.instances[i];
        if (rip.alive && rip.age >= 0 && activeCount < MAX_CLOCK_RIPPLES) {
          this.ripplesUniform[activeCount].set(
            rip.center.x,
            rip.center.y,
            rip.age,
            rip.strength,
          );
          activeCount++;
        }
      }
      this.material.uniforms.uRippleCount.value = activeCount;
    } else {
      this.material.uniforms.uRippleCount.value = 0;
    }

    // Cache key to minimize canvas redraws (redraws once per second or minute)
    const timeSec = this.options.showSeconds ? now.getSeconds() : 0;
    const cacheKey = `${now.getHours()}:${now.getMinutes()}:${timeSec}:${weather}:${this.options.format}:${this.options.showSeconds}`;

    if (cacheKey === this.lastRenderedKey && weather === this.lastWeatherId) {
      return;
    }

    this.lastRenderedKey = cacheKey;
    this.lastWeatherId = weather;
    this.material.uniforms.uCausticColor.value.copy(getCausticColorForWeather(weather));
    this.renderCanvas(now, weather);
  }

  private renderCanvas(now: Date, weather: WeatherPresetId): void {
    const { ctx, canvas } = this;
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");

    let ampm = "";
    if (this.options.format === "12h") {
      ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
    }
    const hourStr = this.options.format === "12h" ? hours.toString() : hours.toString().padStart(2, "0");
    const mainTime = `${hourStr}:${minutes}`;

    // Dynamic optical color adaptation based on active weather preset
    let mainColor = "rgba(255, 255, 255, 0.95)";
    let accentColor = "rgba(255, 255, 255, 0.75)";
    let shadowColor = "rgba(0, 0, 0, 0.38)";
    let shadowBlur = 20;

    if (weather === "moonlight") {
      // Ethereal bioluminescent soft cyan-white glow for night
      mainColor = "rgba(224, 242, 254, 0.96)";
      accentColor = "rgba(186, 230, 253, 0.82)";
      shadowColor = "rgba(14, 165, 233, 0.45)";
      shadowBlur = 28;
    } else if (weather === "sunset") {
      // Warm golden dusk glow
      mainColor = "rgba(255, 247, 237, 0.96)";
      accentColor = "rgba(254, 215, 170, 0.82)";
      shadowColor = "rgba(234, 88, 12, 0.35)";
      shadowBlur = 22;
    } else if (weather === "mist" || weather === "overcast") {
      // Soft monochromatic pearl
      mainColor = "rgba(248, 250, 252, 0.92)";
      accentColor = "rgba(203, 213, 225, 0.75)";
      shadowColor = "rgba(15, 23, 42, 0.38)";
      shadowBlur = 18;
    }

    const centerX = w * 0.5;
    const centerY = h * 0.5;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Ambient drop shadow for high contrast across diverse pond depths
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    // Main Time Digits: Scaled x1.5 (220px), ultra-clean modern typography
    ctx.font = '200 220px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = mainColor;

    if (this.options.showSeconds || this.options.format === "12h") {
      const metrics = ctx.measureText(mainTime);
      const textWidth = metrics.width;
      const startX = centerX - (this.options.showSeconds || this.options.format === "12h" ? 44 : 0);

      ctx.fillText(mainTime, startX, centerY);

      // Trailing auxiliary badge (Seconds or AM/PM)
      ctx.textAlign = "left";
      ctx.font = '300 58px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = accentColor;
      ctx.shadowBlur = shadowBlur * 0.6;

      const badgeX = startX + textWidth * 0.5 + 20;
      if (this.options.showSeconds && this.options.format === "12h") {
        ctx.fillText(ampm, badgeX, centerY - 32);
        ctx.fillText(`:${seconds}`, badgeX, centerY + 32);
      } else if (this.options.showSeconds) {
        ctx.fillText(`:${seconds}`, badgeX, centerY);
      } else if (this.options.format === "12h") {
        ctx.fillText(ampm, badgeX, centerY);
      }
    } else {
      ctx.fillText(mainTime, centerX, centerY);
    }

    ctx.restore();

    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
