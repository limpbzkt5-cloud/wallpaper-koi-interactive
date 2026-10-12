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
  uniform float uTickAge;

  varying vec2 vUv;
  varying vec2 vWorldPos;

  void main() {
    // 1. Subtle fluid undulation (kept subpixel so clock glyphs stay sharp)
    vec2 flowOffset = vec2(
      sin(vUv.y * 14.0 + uTime * 1.85) * 0.0012 + sin((vUv.x + vUv.y) * 22.0 - uTime * 1.35) * 0.0007,
      cos(vUv.x * 12.0 - uTime * 1.60) * 0.0010 + cos((vUv.x - vUv.y) * 18.0 + uTime * 1.20) * 0.0006
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
      rippleOffset += radialDir * waveBand * 0.0025;
    }

    // 3. Micro-ripple dispersion radiating from center upon clock tick (Idea 5)
    if (uTickAge >= 0.0 && uTickAge < 1.4) {
      vec2 tickDelta = vWorldPos - uClockPos;
      float tickDist = length(tickDelta);
      float tickRadius = 8.0 + uTickAge * 72.0;
      float tickDiff = (tickDist - tickRadius) / 10.0;
      float tickWave = exp(-(tickDiff * tickDiff)) * (1.0 - uTickAge / 1.4);
      vec2 tickDir = tickDelta / max(tickDist, 0.1);
      rippleOffset += tickDir * tickWave * 0.0022;
    }

    vec2 baseUv = clamp(vUv + flowOffset + rippleOffset, vec2(0.002), vec2(0.998));

    // 4. Apple Liquid Glass: Surface Normal & Edge Specular Bevel
    float du = 1.0 / 1024.0;
    float dv = 1.0 / 512.0;
    float aR = texture2D(uTexture, baseUv + vec2(du * 3.0, 0.0)).a;
    float aL = texture2D(uTexture, baseUv - vec2(du * 3.0, 0.0)).a;
    float aU = texture2D(uTexture, baseUv + vec2(0.0, dv * 3.0)).a;
    float aD = texture2D(uTexture, baseUv - vec2(0.0, dv * 3.0)).a;
    vec2 edgeNormal = vec2(aR - aL, aU - aD);
    float edgeDist = length(edgeNormal);

    vec4 texColor = texture2D(uTexture, baseUv);
    if (texColor.a <= 0.005) {
      discard;
    }

    // 5. Dynamic traveling caustic light ribbon network
    float c1 = sin(vWorldPos.x * 0.075 + vWorldPos.y * 0.048 + uTime * 2.10);
    float c2 = cos(vWorldPos.x * 0.058 - vWorldPos.y * 0.065 - uTime * 1.75);
    float c3 = sin((vWorldPos.x + vWorldPos.y) * 0.110 - uTime * 2.50);
    float causticIntensity = pow(clamp(0.5 + 0.5 * (c1 * c2 + c3), 0.0, 1.0), 3.0);

    // 6. Apple Liquid Glass Bevel & Specular Highlights
    // Curved liquid glass cross-section: light from top-left casts crisp specular gleam on bevel rim
    vec2 lightDir = normalize(vec2(-0.45, -0.80));
    vec2 normDir = edgeDist > 0.005 ? normalize(edgeNormal) : vec2(0.0);
    float rimLight = clamp(dot(normDir, -lightDir), 0.0, 1.0);
    float specularRim = pow(rimLight, 2.5) * smoothstep(0.10, 0.50, edgeDist);
    float edgeGleam = smoothstep(0.15, 0.60, edgeDist) * 0.35;

    // Pure, luminous frosted white liquid glass material
    vec3 frostedWhite = vec3(1.0, 1.0, 1.0);
    vec3 glassTint = mix(frostedWhite, uCausticColor, 0.15);
    vec3 outColor = mix(texColor.rgb, glassTint, 0.30);

    // Caustic sunlight shimmering through glass core
    float glyphCore = smoothstep(0.35, 0.85, texColor.a);
    outColor += uCausticColor * (causticIntensity * 0.32 * glyphCore);

    // Glossy liquid glass specular rim (bright white liquid edge)
    outColor += vec3(1.0) * (specularRim * 0.85 + edgeGleam * 0.45);

    // Translucent liquid glass alpha with glossy edge emphasis
    float glassAlpha = clamp(texColor.a * (0.85 + specularRim * 0.25), 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(outColor, glassAlpha);
  }
`;

interface ClockThemePalette {
  mainColor: string;
  accentColor: string;
  shadowColor: string;
  shadowBlur: number;
  causticColor: THREE.Color;
}

const THEME_PALETTES: Record<WeatherPresetId, ClockThemePalette> = {
  sunny: {
    // Pure sunlit frosted liquid glass on clear water
    mainColor: "rgba(255, 255, 255, 0.96)",
    accentColor: "rgba(255, 255, 255, 0.80)",
    shadowColor: "rgba(0, 24, 16, 0.35)",
    shadowBlur: 22,
    causticColor: new THREE.Color(0.96, 1.0, 0.95),
  },
  "deep-clear": {
    // Crystalline liquid ice glass over deep pond bed
    mainColor: "rgba(255, 255, 255, 0.96)",
    accentColor: "rgba(225, 248, 255, 0.82)",
    shadowColor: "rgba(0, 16, 28, 0.42)",
    shadowBlur: 24,
    causticColor: new THREE.Color(0.70, 0.92, 1.0),
  },
  sunset: {
    // Warm golden-hour liquid glass catching sunset glow
    mainColor: "rgba(255, 252, 246, 0.96)",
    accentColor: "rgba(255, 232, 205, 0.85)",
    shadowColor: "rgba(48, 16, 10, 0.38)",
    shadowBlur: 22,
    causticColor: new THREE.Color(1.0, 0.88, 0.72),
  },
  moonlight: {
    // Luminous lunar liquid glass under moonlit night
    mainColor: "rgba(242, 252, 255, 0.96)",
    accentColor: "rgba(180, 238, 255, 0.85)",
    shadowColor: "rgba(0, 28, 48, 0.48)",
    shadowBlur: 26,
    causticColor: new THREE.Color(0.65, 0.95, 0.99),
  },
  mist: {
    // Soft frosted morning mist liquid glass
    mainColor: "rgba(255, 255, 255, 0.94)",
    accentColor: "rgba(230, 240, 248, 0.78)",
    shadowColor: "rgba(20, 30, 42, 0.30)",
    shadowBlur: 18,
    causticColor: new THREE.Color(0.88, 0.93, 0.97),
  },
  overcast: {
    // Smooth pearl liquid glass on overcast day
    mainColor: "rgba(255, 255, 255, 0.94)",
    accentColor: "rgba(225, 235, 240, 0.78)",
    shadowColor: "rgba(15, 25, 30, 0.32)",
    shadowBlur: 18,
    causticColor: new THREE.Color(0.85, 0.90, 0.92),
  },
  rain: {
    // Fresh rain-slicked crystal liquid glass
    mainColor: "rgba(255, 255, 255, 0.95)",
    accentColor: "rgba(210, 238, 255, 0.82)",
    shadowColor: "rgba(10, 25, 40, 0.36)",
    shadowBlur: 20,
    causticColor: new THREE.Color(0.80, 0.90, 1.0),
  },
};

function getCausticColorForWeather(weather: WeatherPresetId): THREE.Color {
  return (THEME_PALETTES[weather] ?? THEME_PALETTES.sunny).causticColor;
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
  private lastSecond = -1;
  private lastTickTime = -999;

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
        uTickAge: { value: 999 },
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
    this.mesh.visible = this.options.enabled;

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

    // Track second/minute tick for micro-ripple wave pulse (Idea 5)
    const currentSec = now.getSeconds();
    if (currentSec !== this.lastSecond) {
      this.lastSecond = currentSec;
      this.lastTickTime = time;
    }
    const tickAge = time >= this.lastTickTime ? time - this.lastTickTime : 999;
    this.material.uniforms.uTickAge.value = tickAge;

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
    const cacheKey = `${now.toDateString()}:${now.getHours()}:${now.getMinutes()}:${timeSec}:${weather}:${this.options.format}:${this.options.showSeconds}`;

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

    // Theme palette lookup for the active weather preset
    const theme = THEME_PALETTES[weather] ?? THEME_PALETTES.sunny;
    const { mainColor, accentColor, shadowColor, shadowBlur } = theme;

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

    // Modern Apple-inspired typography stack: clean, elegant, frosted-glass aesthetic
    const FONT_FAMILY =
      '"SF Pro Display", "SF Pro", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
    ctx.font = `500 215px ${FONT_FAMILY}`;
    ctx.fillStyle = mainColor;

    if (this.options.showSeconds || this.options.format === "12h") {
      const metrics = ctx.measureText(mainTime);
      const textWidth = metrics.width;
      const startX = centerX - (this.options.showSeconds || this.options.format === "12h" ? 44 : 0);

      ctx.fillText(mainTime, startX, centerY);

      // Trailing auxiliary badge (Seconds or AM/PM)
      ctx.textAlign = "left";
      ctx.font = `500 56px ${FONT_FAMILY}`;
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
