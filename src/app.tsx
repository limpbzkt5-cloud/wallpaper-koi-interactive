import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AUDIO, AUDIO_TRACKS } from "./audio-config";
import {
  CANVAS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  FIXED_STEP,
  setCanvasSize,
} from "./config";
import { FishRenderer } from "./fish-renderer";
import { createFrameLimiter } from "./frame-limiter";
import { add, clamp, type Vec2, vec } from "./math";
import type { BoatInteractionZone } from "./pixel-boat";
import {
  effectiveFrameRate,
  frameRateOption,
  isFrameRateCap,
  loadPerformancePrefs,
  savePerformancePrefs,
  type PerformancePrefs,
} from "./performance-prefs";
import { connectSettingsEffects } from "./settings/effects";
import { connectPersistence, loadInto } from "./settings/persistence";
import { settings } from "./settings/store";
import { School } from "./school";
import { FishMutation } from "./mutations";
import {
  getWeatherPreset,
  type WeatherPresetId,
} from "./weather";
import type { ClockMode } from "./pond-clock";

interface PondRuntime {
  school: School;
  renderer: FishRenderer;
  showDebug: boolean;
}

// Restores v2 (or migrates v1) localStorage settings into the store before
// the first render, and wires up debounced+pagehide saving from then on.
loadInto(settings);
connectPersistence(settings);

function toBool(value: any): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "1";
  }
  return false;
}

const TARGET_MUTATION_PRESETS: FishMutation[] = [
  FishMutation.None,
  FishMutation.Crimson,
  FishMutation.Bunny,
  FishMutation.Aurora,
  FishMutation.Umbra,
  FishMutation.Midas,
  FishMutation.Electric,
  FishMutation.Frozen,
  FishMutation.Nuclear,
  FishMutation.Mythical,
  FishMutation.RainbowCluster,
  FishMutation.Ishmael,
  FishMutation.Serene,
  FishMutation.Astraeus,
  FishMutation.Abyssal,
];

function parseTargetMutation(val: any): FishMutation {
  const num = Number(val);
  if (!isNaN(num) && num >= 0 && num < TARGET_MUTATION_PRESETS.length) {
    return TARGET_MUTATION_PRESETS[num];
  }
  if (typeof val === "string") {
    const lower = val.toLowerCase();
    if (lower.includes("crimson")) return FishMutation.Crimson;
    if (lower.includes("bunny")) return FishMutation.Bunny;
    if (lower.includes("aurora")) return FishMutation.Aurora;
    if (lower.includes("umbra")) return FishMutation.Umbra;
    if (lower.includes("midas")) return FishMutation.Midas;
    if (lower.includes("electric")) return FishMutation.Electric;
    if (lower.includes("frozen")) return FishMutation.Frozen;
    if (lower.includes("nuclear")) return FishMutation.Nuclear;
    if (lower.includes("mythic")) return FishMutation.Mythical;
    if (lower.includes("rainbow") || lower.includes("cluster")) return FishMutation.RainbowCluster;
    if (lower.includes("ishmael")) return FishMutation.Ishmael;
    if (lower.includes("serene")) return FishMutation.Serene;
    if (lower.includes("astraeus")) return FishMutation.Astraeus;
    if (lower.includes("abyssal")) return FishMutation.Abyssal;
  }
  return FishMutation.None;
}

function pondRenderSize(display: HTMLElement): { width: number; height: number } {
  const { width, height } = display.getBoundingClientRect();
  const screenW = width > 0 ? width : (typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : CANVAS.width);
  const screenH = height > 0 ? height : (typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : CANVAS.height);
  const aspect = screenW / Math.max(1, screenH);

  if (aspect >= 1.0) {
    // Landscape screens (16:9, 16:10, 21:9, 3:2, 4:3, etc.):
    // Maintain standard 270px vertical pixel-art density, scaling horizontal resolution to match screen aspect ratio exactly.
    const baseHeight = CANVAS.height; // 270
    const renderWidth = Math.max(1, Math.round(baseHeight * aspect));
    return { width: renderWidth, height: baseHeight };
  } else {
    // Portrait screens (9:16 mobile, vertical monitor, etc.):
    // Maintain standard 270px horizontal pixel-art density, scaling vertical resolution to match screen aspect ratio.
    const baseWidth = CANVAS.height; // 270
    const renderHeight = Math.max(1, Math.round(baseWidth / aspect));
    return { width: baseWidth, height: renderHeight };
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function App() {
  const stageRef = useRef<HTMLElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ambientAudioContextRef = useRef<AudioContext | null>(null);
  const ambientAudioGainRef = useRef<GainNode | null>(null);
  const ambientAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ambientAudioLoadingRef = useRef<Promise<void> | null>(null);
  const runtimeRef = useRef<PondRuntime | null>(null);
  const soundEnabledRef = useRef<boolean>(AUDIO.defaultEnabled);
  const currentTrackIndexRef = useRef<number>(0);
  const [performancePrefs, setPerformancePrefs] =
    useState<PerformancePrefs>(loadPerformancePrefs);
  const frameRateCap = effectiveFrameRate(performancePrefs, false);
  const frameRateCapRef = useRef(frameRateCap);

  const changeKoiCount = useCallback((amount: number) => {
    const current = runtimeRef.current?.school.count ?? settings.live.koi.initialCount;
    const nextCount = clamp(current + amount, 1, FISH.maximumCount);
    settings.set(["koi", "initialCount"], nextCount);
    runtimeRef.current?.school.setCount(nextCount);
  }, []);

  useEffect(() => {
    frameRateCapRef.current = frameRateCap;
  }, [frameRateCap]);

  const changeFrameRate = useCallback((value: string) => {
    if (!isFrameRateCap(value)) return;
    const next: PerformancePrefs = { version: 1, frameRate: value, explicit: true };
    setPerformancePrefs(next);
    savePerformancePrefs(next);
  }, []);

  const startAmbientAudio = useCallback(async (): Promise<void> => {
    if (ambientAudioSourceRef.current) {
      await ambientAudioContextRef.current?.resume();
      return;
    }
    if (ambientAudioLoadingRef.current) {
      await ambientAudioLoadingRef.current;
      return;
    }

    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.value = soundEnabledRef.current ? AUDIO.ambient.volume : 0;
    gain.connect(context.destination);
    ambientAudioContextRef.current = context;
    ambientAudioGainRef.current = gain;

    const loading = (async (): Promise<void> => {
      await context.resume();
      const loadBuffer = async (path: string): Promise<AudioBuffer> => {
        const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!response.ok) throw new Error(`Unable to load ${path}`);
        return context.decodeAudioData(await response.arrayBuffer());
      };
      const ambientBuffer = await loadBuffer(AUDIO.ambient.source);
      if (context.state === "closed") return;

      const ambientSource = context.createBufferSource();
      ambientSource.buffer = ambientBuffer;
      ambientSource.loop = true;
      ambientSource.connect(gain);
      ambientSource.start();
      ambientAudioSourceRef.current = ambientSource;
    })();
    ambientAudioLoadingRef.current = loading;
    try {
      await loading;
    } finally {
      ambientAudioLoadingRef.current = null;
    }
  }, []);

  const setAmbientSoundEnabled = useCallback((enabled: boolean) => {
    soundEnabledRef.current = enabled;
    if (enabled) void startAmbientAudio().catch(() => undefined);

    const context = ambientAudioContextRef.current;
    const gain = ambientAudioGainRef.current;
    if (context && gain) {
      const now = context.currentTime;
      if (typeof gain.gain.cancelAndHoldAtTime === "function") {
        gain.gain.cancelAndHoldAtTime(now);
      } else {
        const current = gain.gain.value;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(current, now);
      }
      gain.gain.linearRampToValueAtTime(
        enabled ? AUDIO.ambient.volume : 0,
        now + AUDIO.toggleFadeSeconds,
      );
    }
  }, [startAmbientAudio]);

  const switchAmbientTrack = useCallback(async (trackIndex: number): Promise<void> => {
    currentTrackIndexRef.current = trackIndex;
    const track = AUDIO_TRACKS[trackIndex % AUDIO_TRACKS.length];
    const context = ambientAudioContextRef.current;
    const gain = ambientAudioGainRef.current;
    if (!context || !gain) return;

    if (ambientAudioSourceRef.current) {
      try {
        ambientAudioSourceRef.current.stop();
        ambientAudioSourceRef.current.disconnect();
      } catch {}
      ambientAudioSourceRef.current = null;
    }

    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${track.source}`);
      if (!response.ok) return;
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (context.state === "closed") return;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start();
      ambientAudioSourceRef.current = source;

      const now = context.currentTime;
      gain.gain.setValueAtTime(soundEnabledRef.current ? track.volume : 0, now);
    } catch {}
  }, []);

  useEffect(() => {
    const unlockAmbientAudio = (): void => {
      window.removeEventListener("pointerdown", unlockAmbientAudio);
      window.removeEventListener("keydown", unlockAmbientAudio);
      if (soundEnabledRef.current) {
        void startAmbientAudio().catch(() => undefined);
      }
    };

    window.addEventListener("pointerdown", unlockAmbientAudio);
    window.addEventListener("keydown", unlockAmbientAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAmbientAudio);
      window.removeEventListener("keydown", unlockAmbientAudio);
    };
  }, [startAmbientAudio]);

  useEffect(() => () => {
    ambientAudioSourceRef.current?.stop();
    ambientAudioSourceRef.current = null;
    ambientAudioGainRef.current = null;
    const context = ambientAudioContextRef.current;
    ambientAudioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    if (!canvas || !display) return;
    const initialSize = pondRenderSize(display);
    setCanvasSize(initialSize.width, initialSize.height);
    const school = new School();
    const renderer = new FishRenderer(canvas);
    const runtime: PondRuntime = { school, renderer, showDebug: false };
    runtimeRef.current = runtime;
    renderer.pixelBoat.setMusicPlaying(soundEnabledRef.current);
    const activeWeather = getWeatherPreset(settings.meta().weather);
    renderer.setWeatherPreset(activeWeather.id);
    school.setRainIntensity(settings.meta().rain ? 1 : 0);
    const disconnectEffects = connectSettingsEffects(settings, { school, renderer });

    const resizeObserver = new ResizeObserver(() => {
      const nextSize = pondRenderSize(display);
      if (nextSize.width === CANVAS_WIDTH && nextSize.height === CANVAS_HEIGHT) return;
      const oldWidth = CANVAS_WIDTH;
      const oldHeight = CANVAS_HEIGHT;
      setCanvasSize(nextSize.width, nextSize.height);
      school.resize(nextSize.width / oldWidth, nextSize.height / oldHeight);
      renderer.resize(nextSize.width, nextSize.height, oldWidth, oldHeight);
    });
    resizeObserver.observe(display);

    let animationFrame = 0;
    let accumulator = 0;
    let simulationTime = 0;
    let previousTime = performance.now();
    let isSuspended = false;
    let suspendStartTime = performance.now();
    let targetMutation: FishMutation = FishMutation.None;
    let lastForceSpawnVal: boolean | null = null;
    let lastTransformUmbraVal: boolean | null = null;
    let lastTransformAuroraVal: boolean | null = null;
    let lastTransformBunnyVal: boolean | null = null;
    let lastTransformCrimsonVal: boolean | null = null;
    let lastTransformAbyssalVal: boolean | null = null;
    const frameLimiter = createFrameLimiter();

    const animate = (now: number): void => {
      if (isSuspended) return;

      const cap = frameRateOption(frameRateCapRef.current);
      if (!frameLimiter.shouldRender(now, cap.fps)) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }
      accumulator += Math.min((now - previousTime) / 1000, 0.1);
      previousTime = now;
      while (accumulator >= FIXED_STEP) {
        simulationTime += FIXED_STEP;
        school.update(FIXED_STEP, simulationTime, settings.meta().weather);
        accumulator -= FIXED_STEP;
      }

      renderer.draw(school, simulationTime, runtime.showDebug);
      animationFrame = requestAnimationFrame(animate);
    };

    const setSuspended = (suspended: boolean): void => {
      if (isSuspended === suspended) return;
      isSuspended = suspended;

      if (suspended) {
        suspendStartTime = performance.now();
        // Full stop: cancel requestAnimationFrame to guarantee 0% CPU & GPU usage
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
        // Suspend audio context to stop sound processing
        if (
          ambientAudioContextRef.current &&
          ambientAudioContextRef.current.state === "running"
        ) {
          void ambientAudioContextRef.current.suspend().catch(() => undefined);
        }
      } else {
        // Reset timing accumulators on resume to prevent physics teleportation
        previousTime = performance.now();
        accumulator = 0;

        // Resume audio context if sound was enabled
        if (
          soundEnabledRef.current &&
          ambientAudioContextRef.current &&
          ambientAudioContextRef.current.state === "suspended"
        ) {
          void ambientAudioContextRef.current.resume().catch(() => undefined);
        }

        // On-focus pity spawn: if away for >= 45 seconds and visitor koi is not already present,
        // spawn a mutated visitor koi swimming into the pond to reward user attention!
        const awaySeconds = (performance.now() - suspendStartTime) / 1000;
        if (awaySeconds >= 45 && school.visitorActiveCount < school.maxVisitors && school.visitorFrequencySeconds > 0) {
          school.spawnVisitor(settings.meta().weather);
        }

        // Restart animation frame loop
        if (!animationFrame) {
          animationFrame = requestAnimationFrame(animate);
        }
      }
    };

    const isWallpaperEngine = typeof (window as any).wallpaperPropertyListener !== "undefined";
    const isLively = typeof (window as any).livelyPropertyListener !== "undefined";
    const isDesktopWallpaper = isWallpaperEngine || isLively || typeof window.electronAPI !== "undefined";

    const handleVisibilityChange = (): void => {
      // On live wallpapers hosted on desktop, visibilitychange can falsely report 'hidden'
      // on boot behind foreground windows and stall the render loop.
      if (!isDesktopWallpaper) {
        setSuspended(document.visibilityState === "hidden");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Electron Desktop IPC listeners
    if (window.electronAPI) {
      window.electronAPI.onSuspend(() => setSuspended(true));
      window.electronAPI.onResume(() => setSuspended(false));
    }

    // Lively Wallpaper API compatibility handler
    const handleLivelyProperty = (name: string, val: any): void => {
      if (name === "livelyCurrentWallpaperState") {
        setSuspended(!val);
      } else if (name === "koicount") {
        const count = clamp(Math.round(Number(val)), 1, 48);
        settings.set(["koi", "initialCount"], count);
        school.setCount(count);
      } else if (name === "weather") {
        const presets: WeatherPresetId[] = [
          "sunny",
          "sunset",
          "moonlight",
          "rain",
          "overcast",
          "mist",
          "deep-clear",
        ];
        let id: WeatherPresetId = "sunny";
        if (typeof val === "number" && val >= 0 && val < presets.length) {
          id = presets[val];
        } else if (typeof val === "string") {
          const lower = val.toLowerCase();
          const found = presets.find((p) => lower.includes(p));
          if (found) id = found;
        }
        settings.setWeather(id);
        renderer.setWeatherPreset(id);
      } else if (name === "rain") {
        const enabled = Boolean(val);
        settings.setRain(enabled);
        school.setRainIntensity(enabled ? 1 : 0);
      } else if (name === "sound") {
        const enabled = Boolean(val);
        setAmbientSoundEnabled(enabled);
        renderer.pixelBoat.setMusicPlaying(enabled);
      } else if (name === "framerate") {
        const options = ["native", "60", "45", "30"];
        let fps = "native";
        if (typeof val === "number" && val >= 0 && val < options.length) {
          fps = options[val];
        } else if (typeof val === "string") {
          fps = val;
        }
        changeFrameRate(fps);
      } else if (name === "visitorfrequency") {
        const valNum = Number(val);
        if (valNum === 0 || val === "balanced") school.visitorFrequencySeconds = 120;
        else if (valNum === 1 || val === "often") school.visitorFrequencySeconds = 60;
        else if (valNum === 2 || val === "rare") school.visitorFrequencySeconds = 300;
        else if (valNum === 3 || val === "disabled") school.visitorFrequencySeconds = -1;
      } else if (name === "mutationchance") {
        school.mutationChance = clamp(Number(val) / 100, 0, 1);
        school.reseedMutations(settings.meta().weather);
      } else if (name === "targetmutation") {
        targetMutation = parseTargetMutation(val);
      } else if (name.startsWith("allow_")) {
        const mutKey = name.replace("allow_", "");
        for (const mut of Object.values(FishMutation)) {
          if (mut === mutKey) {
            school.setMutationEnabled(mut, toBool(val));
            break;
          }
        }
      } else if (name === "forcespawn") {
        school.transformRandomFish(targetMutation);
      } else if (name.startsWith("transform_")) {
        const mutKey = name.replace("transform_", "");
        for (const mut of Object.values(FishMutation)) {
          if (mut === mutKey) {
            school.transformRandomFish(mut);
            break;
          }
        }
      } else if (name === "cycle_interval") {
        school.cycleIntervalSeconds = Math.max(0, Number(val) * 60);
        school.cycleCountdown = school.cycleIntervalSeconds;
      } else if (name === "clock_enabled") {
        const enabled = toBool(val);
        renderer.pondClock.setEnabled(enabled);
        if (!enabled) renderer.setClockMode("off");
      } else if (name === "clock_mode") {
        const s = String(val).toLowerCase();
        let mode: ClockMode = "submerged";
        if (val === 2 || s.includes("off") || s.includes("disable")) {
          mode = "off";
        } else if (val === 1 || s.includes("floating")) {
          mode = "floating";
        }
        renderer.setClockMode(mode);
      } else if (name === "clock_format") {
        const fmt = Number(val) === 1 || String(val).includes("12") ? "12h" : "24h";
        renderer.pondClock.setFormat(fmt);
      } else if (name === "clock_seconds") {
        renderer.pondClock.setShowSeconds(toBool(val));
      } else if (name === "clock_opacity") {
        renderer.pondClock.setOpacity(Number(val) / 100);
      } else if (name === "clock_position") {
        renderer.pondClock.setPosition("center");
      } else if (name === "boat_scale") {
        const scalePct = clamp(Number(val), 0, 200);
        renderer.pixelBoat.setScale(scalePct / 100);
      } else if (name === "boat_speed") {
        const speedPct = clamp(Number(val), 0, 200);
        renderer.pixelBoat.setSpeedMultiplier(speedPct / 100);
      } else if (name === "boat_position") {
        const posMap: Record<number | string, "right" | "left" | "top-right" | "bottom-center"> = {
          0: "right",
          1: "left",
          2: "top-right",
          3: "bottom-center",
        };
        const preset = posMap[val] ?? (typeof val === "string" ? (val.toLowerCase() as any) : "right");
        renderer.pixelBoat.setPositionPreset(preset);
      } else if (name === "scatter") {
        school.scatter();
      } else if (name === "reset") {
        school.reset();
      }
    };

    // Wallpaper Engine API compatibility handler
    const applyWallpaperProperties = (properties: Record<string, { value: any }>): void => {
      if (!properties) return;
      if (properties.koicount !== undefined && properties.koicount.value !== undefined) {
        const count = clamp(Math.round(Number(properties.koicount.value)), 1, 48);
        settings.set(["koi", "initialCount"], count);
        school.setCount(count);
      }
      if (properties.weather !== undefined && properties.weather.value !== undefined) {
        const id = String(properties.weather.value) as WeatherPresetId;
        settings.setWeather(id);
        renderer.setWeatherPreset(id);
      }
      if (properties.rain !== undefined && properties.rain.value !== undefined) {
        const enabled = Boolean(properties.rain.value);
        settings.setRain(enabled);
        school.setRainIntensity(enabled ? 1 : 0);
      }
      if (properties.sound !== undefined && properties.sound.value !== undefined) {
        const enabled = Boolean(properties.sound.value);
        setAmbientSoundEnabled(enabled);
        renderer.pixelBoat.setMusicPlaying(enabled);
      }
      if (properties.framerate !== undefined && properties.framerate.value !== undefined) {
        changeFrameRate(String(properties.framerate.value));
      }
      if (properties.visitorfrequency !== undefined && properties.visitorfrequency.value !== undefined) {
        const val = properties.visitorfrequency.value;
        const valNum = Number(val);
        if (valNum === 0 || val === "balanced") school.visitorFrequencySeconds = 120;
        else if (valNum === 1 || val === "often") school.visitorFrequencySeconds = 60;
        else if (valNum === 2 || val === "rare") school.visitorFrequencySeconds = 300;
        else if (valNum === 3 || val === "disabled") school.visitorFrequencySeconds = -1;
      }
      if (properties.cycle_interval !== undefined && properties.cycle_interval.value !== undefined) {
        const mins = Math.max(0, Number(properties.cycle_interval.value));
        school.cycleIntervalSeconds = mins * 60;
        school.cycleCountdown = school.cycleIntervalSeconds;
      }
      let mutationSettingsChanged = false;
      for (const mut of Object.values(FishMutation)) {
        if (mut === FishMutation.None) continue;
        const propKey = `allow_${mut}`;
        if (properties[propKey] !== undefined && properties[propKey].value !== undefined) {
          const val = toBool(properties[propKey].value);
          if (school.enabledMutations[mut] !== val) {
            school.setMutationEnabled(mut, val);
            mutationSettingsChanged = true;
          }
        }
      }
      if (properties.mutationchance !== undefined && properties.mutationchance.value !== undefined) {
        const chance = clamp(Number(properties.mutationchance.value) / 100, 0, 1);
        if (school.mutationChance !== chance) {
          school.mutationChance = chance;
          mutationSettingsChanged = true;
        }
      }
      if (mutationSettingsChanged) {
        school.reseedMutations(settings.meta().weather);
      }
      if (properties.targetmutation !== undefined && properties.targetmutation.value !== undefined) {
        targetMutation = parseTargetMutation(properties.targetmutation.value);
      }
      if (properties.forcespawn !== undefined && properties.forcespawn.value !== undefined) {
        const val = Boolean(properties.forcespawn.value);
        if (lastForceSpawnVal === null) {
          lastForceSpawnVal = val;
        } else if (lastForceSpawnVal !== val) {
          lastForceSpawnVal = val;
          school.transformRandomFish(targetMutation);
        }
      }
      if (properties.transform_umbra !== undefined && properties.transform_umbra.value !== undefined) {
        const val = Boolean(properties.transform_umbra.value);
        if (lastTransformUmbraVal === null) {
          lastTransformUmbraVal = val;
        } else if (lastTransformUmbraVal !== val) {
          lastTransformUmbraVal = val;
          school.transformRandomFish(FishMutation.Umbra);
        }
      }
      if (properties.transform_aurora !== undefined && properties.transform_aurora.value !== undefined) {
        const val = Boolean(properties.transform_aurora.value);
        if (lastTransformAuroraVal === null) {
          lastTransformAuroraVal = val;
        } else if (lastTransformAuroraVal !== val) {
          lastTransformAuroraVal = val;
          school.transformRandomFish(FishMutation.Aurora);
        }
      }
      if (properties.transform_bunny !== undefined && properties.transform_bunny.value !== undefined) {
        const val = Boolean(properties.transform_bunny.value);
        if (lastTransformBunnyVal === null) {
          lastTransformBunnyVal = val;
        } else if (lastTransformBunnyVal !== val) {
          lastTransformBunnyVal = val;
          school.transformRandomFish(FishMutation.Bunny);
        }
      }
      if (properties.transform_crimson !== undefined && properties.transform_crimson.value !== undefined) {
        const val = Boolean(properties.transform_crimson.value);
        if (lastTransformCrimsonVal === null) {
          lastTransformCrimsonVal = val;
        } else if (lastTransformCrimsonVal !== val) {
          lastTransformCrimsonVal = val;
          school.transformRandomFish(FishMutation.Crimson);
        }
      }
      if (properties.transform_abyssal !== undefined && properties.transform_abyssal.value !== undefined) {
        const val = Boolean(properties.transform_abyssal.value);
        if (lastTransformAbyssalVal === null) {
          lastTransformAbyssalVal = val;
        } else if (lastTransformAbyssalVal !== val) {
          lastTransformAbyssalVal = val;
          school.transformRandomFish(FishMutation.Abyssal);
        }
      }
      if (properties.clock_enabled !== undefined && properties.clock_enabled.value !== undefined) {
        const enabled = toBool(properties.clock_enabled.value);
        renderer.pondClock.setEnabled(enabled);
        if (!enabled) renderer.setClockMode("off");
      }
      if (properties.clock_mode !== undefined && properties.clock_mode.value !== undefined) {
        const val = properties.clock_mode.value;
        const s = String(val).toLowerCase();
        let mode: ClockMode = "submerged";
        if (val === 2 || s.includes("off") || s.includes("disable")) {
          mode = "off";
        } else if (val === 1 || s.includes("floating")) {
          mode = "floating";
        }
        renderer.setClockMode(mode);
      }
      if (properties.clock_format !== undefined && properties.clock_format.value !== undefined) {
        const val = properties.clock_format.value;
        const fmt = Number(val) === 1 || String(val).includes("12") ? "12h" : "24h";
        renderer.pondClock.setFormat(fmt);
      }
      if (properties.clock_seconds !== undefined && properties.clock_seconds.value !== undefined) {
        renderer.pondClock.setShowSeconds(toBool(properties.clock_seconds.value));
      }
      if (properties.clock_opacity !== undefined && properties.clock_opacity.value !== undefined) {
        renderer.pondClock.setOpacity(Number(properties.clock_opacity.value) / 100);
      }
      if (properties.clock_position !== undefined && properties.clock_position.value !== undefined) {
        renderer.pondClock.setPosition("center");
      }
      if (properties.boat_scale !== undefined && properties.boat_scale.value !== undefined) {
        const scalePct = clamp(Number(properties.boat_scale.value), 0, 200);
        renderer.pixelBoat.setScale(scalePct / 100);
      }
      if (properties.boat_speed !== undefined && properties.boat_speed.value !== undefined) {
        const speedPct = clamp(Number(properties.boat_speed.value), 0, 200);
        renderer.pixelBoat.setSpeedMultiplier(speedPct / 100);
      }
      if (properties.boat_position !== undefined && properties.boat_position.value !== undefined) {
        const val = properties.boat_position.value;
        const posMap: Record<number | string, "right" | "left" | "top-right" | "bottom-center"> = {
          0: "right",
          1: "left",
          2: "top-right",
          3: "bottom-center",
        };
        const preset = posMap[val] ?? (typeof val === "string" ? (val.toLowerCase() as any) : "right");
        renderer.pixelBoat.setPositionPreset(preset);
      }
    };

    // Attach active listener hooks to global bridge
    window._onWallpaperProperties = applyWallpaperProperties;
    window._onWallpaperPaused = (isPaused: boolean) => setSuspended(isPaused);
    window.wallpaperPropertyListener = {
      applyUserProperties: applyWallpaperProperties,
      applyGeneralProperties: () => {},
      setPaused: (isPaused: boolean) => setSuspended(isPaused),
    };

    // Flush any early properties caught by index.html early bridge before React mounted
    if (window._pendingWallpaperProperties) {
      applyWallpaperProperties(window._pendingWallpaperProperties);
    }
    if (window._pendingWallpaperPaused !== null && window._pendingWallpaperPaused !== undefined) {
      setSuspended(window._pendingWallpaperPaused);
    }

    // Connect Lively bridge and flush pending properties
    window._onLivelyProperty = handleLivelyProperty;
    window.livelyPropertyListener = handleLivelyProperty;
    if (window._pendingLivelyProperties && window._pendingLivelyProperties.length > 0) {
      for (const item of window._pendingLivelyProperties) {
        handleLivelyProperty(item.name, item.val);
      }
      window._pendingLivelyProperties = [];
    }

    // Register Wallpaper Engine Audio & Media listeners for automatic sync
    const win = window as any;
    if (typeof win !== "undefined") {
      // 1. Audio visualizer frequency listener
      if (typeof win.wallpaperRegisterAudioListener === "function") {
        win.wallpaperRegisterAudioListener((audioArray: number[]) => {
          if (!audioArray || audioArray.length === 0) return;
          let sum = 0;
          for (let i = 0; i < audioArray.length; i++) {
            sum += audioArray[i];
          }
          const avg = sum / audioArray.length;
          const hasExternalAudio = avg > 0.005;
          renderer.pixelBoat.setSystemAudioPlaying(hasExternalAudio, avg);
        });
      }

      // 2. Windows Media Session playback status listener (Spotify, YouTube, etc.)
      if (typeof win.wallpaperRegisterMediaPlaybackListener === "function") {
        win.wallpaperRegisterMediaPlaybackListener((event: { state: number }) => {
          const isPlaying = event && event.state === 1;
          renderer.pixelBoat.setMediaSessionPlaying(isPlaying);
        });
      }

      // 3. Windows Media track title & artist listener
      if (typeof win.wallpaperRegisterMediaPropertiesListener === "function") {
        win.wallpaperRegisterMediaPropertiesListener((event: { title?: string; artist?: string }) => {
          if (event && (event.title || event.artist)) {
            renderer.pixelBoat.setTrackMetadata(event.title || "", event.artist || "");
          }
        });
      }
    }

    interface ActiveBoatInteraction {
      startPos: Vec2;
      zone: BoatInteractionZone;
      isDraggingBoat: boolean;
    }
    let activeBoatInteraction: ActiveBoatInteraction | null = null;
    let isMouseDown = false;
    let lastDownTimestamp = 0;

    const getPondPointerPos = (clientX: number, clientY: number): Vec2 => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width > 0 ? bounds.width : (window.innerWidth || CANVAS_WIDTH);
      const height = bounds.height > 0 ? bounds.height : (window.innerHeight || CANVAS_HEIGHT);
      const left = bounds.left || 0;
      const top = bounds.top || 0;
      const x = clamp(((clientX - left) / width) * CANVAS_WIDTH, 0, CANVAS_WIDTH);
      const y = clamp(((clientY - top) / height) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT);
      return vec(x, y);
    };

    const handlePointerDown = (event: MouseEvent | PointerEvent): void => {
      const now = performance.now();
      if (now - lastDownTimestamp < 25) return; // Prevent double firing when browser sends both pointerdown & mousedown
      lastDownTimestamp = now;

      isMouseDown = true;
      if (isSuspended) {
        setSuspended(false);
      }

      const pointerPos = getPondPointerPos(event.clientX, event.clientY);
      const zone = renderer.pixelBoat.hitTest(pointerPos);

      if (zone !== null) {
        activeBoatInteraction = {
          startPos: pointerPos,
          zone,
          isDraggingBoat: false,
        };
        return;
      }

      renderer.pondFauna.notifyWaterDisturbed(pointerPos);
      school.callTo(pointerPos);
      if (soundEnabledRef.current && ambientAudioContextRef.current?.state === "suspended") {
        void ambientAudioContextRef.current.resume().catch(() => undefined);
      }
    };

    let lastMoveTime = 0;
    const handlePointerMove = (event: MouseEvent | PointerEvent): void => {
      if (!isMouseDown) return;

      const pointerPos = getPondPointerPos(event.clientX, event.clientY);

      if (activeBoatInteraction) {
        const dist = Math.hypot(
          pointerPos.x - activeBoatInteraction.startPos.x,
          pointerPos.y - activeBoatInteraction.startPos.y,
        );
        if (dist > 2.0 || activeBoatInteraction.isDraggingBoat) {
          if (!activeBoatInteraction.isDraggingBoat) {
            activeBoatInteraction.isDraggingBoat = true;
            renderer.pixelBoat.startDrag(pointerPos);
          }
          renderer.pixelBoat.updateDrag(pointerPos, (pos) => {
            school.ripples.trigger("mouth", pos);
          });
          return;
        }
      }

      const now = performance.now();
      if (now - lastMoveTime < 45) return;
      lastMoveTime = now;

      if (!activeBoatInteraction) {
        school.callTo(pointerPos);
      }
    };

    const handlePointerUp = (event: MouseEvent | PointerEvent): void => {
      if (!isMouseDown && !activeBoatInteraction) return;
      isMouseDown = false;

      if (activeBoatInteraction) {
        const pointerPos = getPondPointerPos(event.clientX, event.clientY);

        if (activeBoatInteraction.isDraggingBoat) {
          renderer.pixelBoat.updateDrag(pointerPos);
          renderer.pixelBoat.endDrag((dropPos) => {
            school.ripples.trigger("touch", dropPos);
            school.callTo(dropPos);
          });
        } else {
          // Pure Click interaction
          if (activeBoatInteraction.zone === "anchor") {
            renderer.pixelBoat.toggleAnchor((splashPos) => {
              school.ripples.trigger("touch", splashPos);
            });
            school.ripples.trigger("mouth", pointerPos);
          } else if (activeBoatInteraction.zone === "music") {
            renderer.pixelBoat.triggerButtonFeedback("play");
            const nextSound = !soundEnabledRef.current;
            setAmbientSoundEnabled(nextSound);
            renderer.pixelBoat.setMusicPlaying(nextSound);
            school.ripples.trigger("mouth", pointerPos);
            if (nextSound && ambientAudioContextRef.current?.state === "suspended") {
              void ambientAudioContextRef.current.resume().catch(() => undefined);
            }
          } else {
            // Food Feeder compartment: drop food pellets to feed koi
            const boatPos = renderer.pixelBoat.options.position;
            const dropTarget = add(
              boatPos,
              vec(
                22 * (renderer.pixelBoat.facingLeft ? 1 : -1) * renderer.pixelBoat.options.scale,
                16 * renderer.pixelBoat.options.scale,
              ),
            );
            renderer.pixelBoat.dropFoodPellets(dropTarget, (splashPos) => {
              school.ripples.trigger("touch", splashPos);
              school.callTo(splashPos);
            });
          }
        }
        activeBoatInteraction = null;
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown as EventListener);
    canvas.addEventListener("mousedown", handlePointerDown as EventListener);
    window.addEventListener("pointermove", handlePointerMove as EventListener);
    window.addEventListener("mousemove", handlePointerMove as EventListener);
    window.addEventListener("pointerup", handlePointerUp as EventListener);
    window.addEventListener("mouseup", handlePointerUp as EventListener);

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (isEditableTarget(event.target)) return;
      switch (event.code) {
        case "Space":
          event.preventDefault();
          school.scatter();
          break;
        case "BracketLeft":
          changeKoiCount(-1);
          break;
        case "BracketRight":
          changeKoiCount(1);
          break;
        case "KeyC":
          // Cycle clock modes: Submerged -> Floating -> Disabled -> Submerged
          if (!renderer.pondClock.options.enabled) {
            renderer.pondClock.setEnabled(true);
            renderer.setClockMode("submerged");
          } else if (renderer.pondClock.options.mode === "submerged") {
            renderer.setClockMode("floating");
          } else {
            renderer.pondClock.setEnabled(false);
          }
          break;
        case "KeyD":
          runtime.showDebug = !runtime.showDebug;
          break;
        case "KeyR":
          school.reset();
          break;
        case "KeyU":
          school.transformRandomFish(FishMutation.Umbra);
          break;
        case "KeyI":
          school.transformRandomFish(FishMutation.Ishmael);
          break;
        case "KeyS":
          school.transformRandomFish(FishMutation.Serene);
          break;
        case "KeyA":
          school.transformRandomFish(FishMutation.Astraeus);
          break;
        case "KeyO":
        case "Equal":
          school.transformRandomFish(FishMutation.Abyssal);
          break;
        case "KeyM":
          school.transformRandomFish(targetMutation);
          break;
        case "Digit1":
          school.transformRandomFish(FishMutation.Crimson);
          break;
        case "Digit2":
          school.transformRandomFish(FishMutation.Bunny);
          break;
        case "Digit3":
          school.transformRandomFish(FishMutation.Aurora);
          break;
        case "Digit4":
          school.transformRandomFish(FishMutation.Umbra);
          break;
        case "Digit5":
          school.transformRandomFish(FishMutation.Midas);
          break;
        case "Digit6":
          school.transformRandomFish(FishMutation.Electric);
          break;
        case "Digit7":
          school.transformRandomFish(FishMutation.Frozen);
          break;
        case "Digit8":
          school.transformRandomFish(FishMutation.Nuclear);
          break;
        case "Digit9":
          school.transformRandomFish(FishMutation.Mythical);
          break;
        case "Digit0":
          school.transformRandomFish(FishMutation.RainbowCluster);
          break;
        case "Minus":
        case "Backquote":
          school.transformRandomFish(FishMutation.None);
          break;
        case "KeyB": {
          const boatPos = renderer.pixelBoat.options.position;
          const dropPos = add(
            boatPos,
            vec(14 * renderer.pixelBoat.options.scale, 14 * renderer.pixelBoat.options.scale),
          );
          renderer.pixelBoat.dropFoodPellets(dropPos, (splashPos) => {
            school.ripples.trigger("touch", splashPos);
            school.callTo(splashPos);
          });
          break;
        }
        case "KeyN": {
          const nextIdx = (currentTrackIndexRef.current + 1) % AUDIO_TRACKS.length;
          currentTrackIndexRef.current = nextIdx;
          const track = AUDIO_TRACKS[nextIdx];
          renderer.pixelBoat.setTrackMetadata(track.name);
          if (soundEnabledRef.current) {
            void switchAmbientTrack(nextIdx);
          }
          break;
        }
        case "KeyP": {
          const prevIdx = (currentTrackIndexRef.current - 1 + AUDIO_TRACKS.length) % AUDIO_TRACKS.length;
          currentTrackIndexRef.current = prevIdx;
          const track = AUDIO_TRACKS[prevIdx];
          renderer.pixelBoat.setTrackMetadata(track.name);
          if (soundEnabledRef.current) {
            void switchAmbientTrack(prevIdx);
          }
          break;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    animationFrame = requestAnimationFrame(animate);

    return () => {
      setSuspended(true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      delete window._onWallpaperProperties;
      delete window._onWallpaperPaused;
      delete window._onLivelyProperty;
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      disconnectEffects();
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown as EventListener);
      canvas.removeEventListener("mousedown", handlePointerDown as EventListener);
      window.removeEventListener("pointermove", handlePointerMove as EventListener);
      window.removeEventListener("mousemove", handlePointerMove as EventListener);
      window.removeEventListener("pointerup", handlePointerUp as EventListener);
      window.removeEventListener("mouseup", handlePointerUp as EventListener);
      window.removeEventListener("keydown", handleKeyDown);
      renderer.dispose();
      runtimeRef.current = null;
    };
  }, [changeFrameRate, changeKoiCount, setAmbientSoundEnabled]);

  return (
    <main
      ref={stageRef}
      className="stage"
      aria-label="Procedural koi simulation"
    >
      <div className="pond-shell">
        <div className="display" ref={displayRef}>
          <canvas
            ref={canvasRef}
            id="pond"
            aria-label="Animated procedural koi"
          />
        </div>
      </div>
    </main>
  );
}
