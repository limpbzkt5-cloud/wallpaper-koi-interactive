import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AUDIO } from "./audio-config";
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
import { clamp, vec } from "./math";
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
  }
  return FishMutation.None;
}

function pondRenderSize(display: HTMLElement): { width: number; height: number } {
  const { width, height } = display.getBoundingClientRect();
  const portrait =
    window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches &&
    width > 0 &&
    height > 0;
  if (!portrait) return { width: CANVAS.width, height: CANVAS.height };

  const renderWidth = Math.min(
    CANVAS.width,
    Math.max(CANVAS.height, Math.round(width * 0.7)),
  );
  return {
    width: renderWidth,
    height: Math.max(CANVAS.height, Math.round((renderWidth * height) / width)),
  };
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

    const handleVisibilityChange = (): void => {
      setSuspended(document.visibilityState === "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Electron Desktop IPC listeners
    if (window.electronAPI) {
      window.electronAPI.onSuspend(() => setSuspended(true));
      window.electronAPI.onResume(() => setSuspended(false));
    }

    // Lively Wallpaper API compatibility
    window.livelyPropertyListener = (name: string, val: any) => {
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
        const posMap: Record<number | string, "center" | "top-right" | "top-left" | "bottom-center"> = {
          0: "center",
          1: "top-right",
          2: "top-left",
          3: "bottom-center",
        };
        const pos = posMap[val] ?? (typeof val === "string" ? (val.toLowerCase() as any) : "center");
        renderer.pondClock.setPosition(pos);
      } else if (name === "scatter") {
        school.scatter();
      } else if (name === "reset") {
        school.reset();
      }
    };

    // Wallpaper Engine API compatibility
    (window as any).wallpaperPropertyListener = {
      applyUserProperties: (properties: Record<string, { value: any }>) => {
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
          const val = properties.clock_position.value;
          const posMap: Record<number | string, "center" | "top-right" | "top-left" | "bottom-center"> = {
            0: "center",
            1: "top-right",
            2: "top-left",
            3: "bottom-center",
          };
          const pos = posMap[val] ?? (typeof val === "string" ? (val.toLowerCase() as any) : "center");
          renderer.pondClock.setPosition(pos);
        }
      },
      applyGeneralProperties: (properties: Record<string, any>) => {
        if (properties && properties.fps) {
          // General max FPS from Wallpaper Engine
        }
      },
      setPaused: (isPaused: boolean) => {
        setSuspended(isPaused);
      },
    };

    const handleGlobalPointer = (event: MouseEvent | PointerEvent): void => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width > 0 ? bounds.width : (window.innerWidth || CANVAS_WIDTH);
      const height = bounds.height > 0 ? bounds.height : (window.innerHeight || CANVAS_HEIGHT);
      const left = bounds.left || 0;
      const top = bounds.top || 0;
      const x = clamp(((event.clientX - left) / width) * CANVAS_WIDTH, 0, CANVAS_WIDTH);
      const y = clamp(((event.clientY - top) / height) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT);
      school.callTo(vec(x, y));
      if (soundEnabledRef.current && ambientAudioContextRef.current?.state === "suspended") {
        void ambientAudioContextRef.current.resume().catch(() => undefined);
      }
    };

    window.addEventListener("pointerdown", handleGlobalPointer);
    window.addEventListener("mousedown", handleGlobalPointer);

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
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    animationFrame = requestAnimationFrame(animate);

    return () => {
      setSuspended(true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (window.livelyPropertyListener) {
        delete (window as any).livelyPropertyListener;
      }
      if ((window as any).wallpaperPropertyListener) {
        delete (window as any).wallpaperPropertyListener;
      }
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      disconnectEffects();
      resizeObserver.disconnect();
      window.removeEventListener("pointerdown", handleGlobalPointer);
      window.removeEventListener("mousedown", handleGlobalPointer);
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
