import * as THREE from "three";
import type { WeatherPresetId } from "./weather";
import type { XorShift32 } from "./math";

export enum FishMutation {
  None = "none",
  Crimson = "crimson",
  Bunny = "bunny",
  Aurora = "aurora",
  Umbra = "umbra",
  Midas = "midas",
  Electric = "electric",
  Frozen = "frozen",
  Nuclear = "nuclear",
  Mythical = "mythical",
  RainbowCluster = "rainbow_cluster",
  Ishmael = "ishmael",
  Serene = "serene",
  Astraeus = "astraeus",
  Abyssal = "abyssal",
}

export type MutationRarity = "Common" | "Special" | "Rare" | "Legendary" | "Mythic";

export interface MutationDefinition {
  id: FishMutation;
  name: string;
  rarity: MutationRarity;
  baseWeight: number;
  emissive: number;
  opacity: number;
  speedScale: number;
  sizeScale: number;
  colors: {
    base: string | number;
    accent: string | number;
    marking: string | number;
    fin: string | number;
    eye: string | number;
  };
}

export const MUTATION_DEFINITIONS: Record<FishMutation, MutationDefinition> = {
  [FishMutation.None]: {
    id: FishMutation.None,
    name: "Normal",
    rarity: "Common",
    baseWeight: 800,
    emissive: 0,
    opacity: 1.0,
    speedScale: 1.0,
    sizeScale: 1.0,
    colors: {
      base: "#ffffff",
      accent: "#ff4422",
      marking: "#111111",
      fin: "#ffffff",
      eye: "#111111",
    },
  },
  [FishMutation.Crimson]: {
    id: FishMutation.Crimson,
    name: "Crimson",
    rarity: "Rare",
    baseWeight: 55,
    emissive: 0.65,
    opacity: 0.55,
    speedScale: 1.12,
    sizeScale: 1.04,
    colors: {
      base: "#dc2626",
      accent: "#991b1b",
      marking: "#ef4444",
      fin: "#b91c1c",
      eye: "#fca5a5",
    },
  },
  [FishMutation.Bunny]: {
    id: FishMutation.Bunny,
    name: "Bunny",
    rarity: "Special",
    baseWeight: 35,
    emissive: 0.25,
    opacity: 1.0,
    speedScale: 1.05,
    sizeScale: 1.06,
    colors: {
      base: "#f5ebe0",
      accent: "#ffb5a7",
      marking: "#fcd5ce",
      fin: "#f8edeb",
      eye: "#5c3d2e",
    },
  },
  [FishMutation.Aurora]: {
    id: FishMutation.Aurora,
    name: "Aurora",
    rarity: "Legendary",
    baseWeight: 25,
    emissive: 1.0,
    opacity: 0.95,
    speedScale: 1.2,
    sizeScale: 1.1,
    colors: {
      base: "#06b6d4",
      accent: "#10b981",
      marking: "#38bdf8",
      fin: "#6ee7b7",
      eye: "#ffffff",
    },
  },
  [FishMutation.Umbra]: {
    id: FishMutation.Umbra,
    name: "Umbra",
    rarity: "Mythic",
    baseWeight: 18,
    emissive: 1.0,
    opacity: 1.0,
    speedScale: 1.15,
    sizeScale: 1.12,
    colors: {
      base: "#141028",
      accent: "#ffb703",
      marking: "#8c7bf7",
      fin: "#7c6cf0",
      eye: "#fff066",
    },
  },
  [FishMutation.Midas]: {
    id: FishMutation.Midas,
    name: "Midas",
    rarity: "Legendary",
    baseWeight: 28,
    emissive: 0.90,
    opacity: 1.0,
    speedScale: 1.15,
    sizeScale: 1.08,
    colors: {
      base: "#f59e0b",
      accent: "#fbbf24",
      marking: "#d97706",
      fin: "#fde68a",
      eye: "#ffffff",
    },
  },
  [FishMutation.Electric]: {
    id: FishMutation.Electric,
    name: "Electric",
    rarity: "Rare",
    baseWeight: 45,
    emissive: 0.85,
    opacity: 1.0,
    speedScale: 1.25,
    sizeScale: 1.02,
    colors: {
      base: "#0b132b",
      accent: "#00f5ff",
      marking: "#7000ff",
      fin: "#00b4d8",
      eye: "#ffffff",
    },
  },
  [FishMutation.Frozen]: {
    id: FishMutation.Frozen,
    name: "Frozen",
    rarity: "Rare",
    baseWeight: 40,
    emissive: 0.50,
    opacity: 0.72,
    speedScale: 0.92,
    sizeScale: 1.05,
    colors: {
      base: "#e0f2fe",
      accent: "#38bdf8",
      marking: "#0284c7",
      fin: "#bae6fd",
      eye: "#0ea5e9",
    },
  },
  [FishMutation.Nuclear]: {
    id: FishMutation.Nuclear,
    name: "Nuclear",
    rarity: "Special",
    baseWeight: 35,
    emissive: 0.95,
    opacity: 0.95,
    speedScale: 1.18,
    sizeScale: 1.06,
    colors: {
      base: "#0d2818",
      accent: "#39ff14",
      marking: "#70e000",
      fin: "#00ff87",
      eye: "#39ff14",
    },
  },
  [FishMutation.Mythical]: {
    id: FishMutation.Mythical,
    name: "Mythical",
    rarity: "Mythic",
    baseWeight: 16,
    emissive: 1.0,
    opacity: 1.0,
    speedScale: 1.22,
    sizeScale: 1.12,
    colors: {
      base: "#ff007f",
      accent: "#00f5ff",
      marking: "#ffe600",
      fin: "#a855f7",
      eye: "#ffffff",
    },
  },
  [FishMutation.RainbowCluster]: {
    id: FishMutation.RainbowCluster,
    name: "Rainbow Cluster",
    rarity: "Legendary",
    baseWeight: 24,
    emissive: 0.85,
    opacity: 0.95,
    speedScale: 1.10,
    sizeScale: 1.08,
    colors: {
      base: "#ffb3ba",
      accent: "#baffc9",
      marking: "#ffffba",
      fin: "#bae1ff",
      eye: "#ffffff",
    },
  },
  [FishMutation.Ishmael]: {
    id: FishMutation.Ishmael,
    name: "Ishmael",
    rarity: "Rare",
    baseWeight: 45,
    emissive: 0.35,
    opacity: 1.0,
    speedScale: 1.14,
    sizeScale: 1.05,
    colors: {
      base: "#e66f42",
      accent: "#be522a",
      marking: "#422514",
      fin: "#db683d",
      eye: "#7c6838",
    },
  },
  [FishMutation.Serene]: {
    id: FishMutation.Serene,
    name: "Serene",
    rarity: "Rare",
    baseWeight: 45,
    emissive: 0.85,
    opacity: 0.95,
    speedScale: 1.15,
    sizeScale: 1.06,
    colors: {
      base: "#071126",
      accent: "#00ffe1",
      marking: "#0284c7",
      fin: "#38bdf8",
      eye: "#ffffff",
    },
  },
  [FishMutation.Astraeus]: {
    id: FishMutation.Astraeus,
    name: "Astraeus",
    rarity: "Mythic",
    baseWeight: 18,
    emissive: 1.0,
    opacity: 1.0,
    speedScale: 1.20,
    sizeScale: 1.12,
    colors: {
      base: "#1a082b",
      accent: "#ff8c00",
      marking: "#c084fc",
      fin: "#9333ea",
      eye: "#ffedd5",
    },
  },
  [FishMutation.Abyssal]: {
    id: FishMutation.Abyssal,
    name: "Abyssal",
    rarity: "Mythic",
    baseWeight: 18,
    emissive: 1.0,
    opacity: 1.0,
    speedScale: 1.18,
    sizeScale: 1.12,
    colors: {
      base: "#0c0fd4",
      accent: "#7950f2",
      marking: "#00d2ff",
      fin: "#4338ca",
      eye: "#38bdf8",
    },
  },
};

export function rollMutation(
  random: XorShift32,
  weather: WeatherPresetId,
  mutationChanceMultiplier: number = 0.70,
  forceMutated: boolean = false,
  enabledMutations?: Partial<Record<FishMutation, boolean>>,
): FishMutation {
  if (!forceMutated) {
    if (random.range(0, 1) > mutationChanceMultiplier) {
      return FishMutation.None;
    }
  }

  const allMutations: FishMutation[] = [
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

  const mutationKeys = allMutations.filter((id) =>
    enabledMutations ? enabledMutations[id] === true : true,
  );

  if (mutationKeys.length === 0) {
    return FishMutation.None;
  }

  let totalWeight = 0;
  const weightedList: { id: FishMutation; weight: number }[] = [];

  for (const id of mutationKeys) {
    const def = MUTATION_DEFINITIONS[id];
    let weight = def.baseWeight;

    // Environmental synergies from weather
    if (weather === "rain") {
      if (id === FishMutation.Crimson) weight *= 2.0;
      if (id === FishMutation.Electric) weight *= 3.5;
      if (id === FishMutation.RainbowCluster) weight *= 2.5;
      if (id === FishMutation.Ishmael) weight *= 3.0; // Great Lake nautical synergy
      if (id === FishMutation.Abyssal) weight *= 2.0;
    }
    if (weather === "moonlight") {
      if (id === FishMutation.Aurora) weight *= 3.5;
      if (id === FishMutation.Mythical) weight *= 3.0;
      if (id === FishMutation.Frozen) weight *= 2.5;
      if (id === FishMutation.Serene) weight *= 3.5; // Polaris night sky synergy
      if (id === FishMutation.Astraeus) weight *= 3.0; // Titan of the night stars
      if (id === FishMutation.Abyssal) weight *= 3.5; // Deep ocean nocturnal synergy
    }
    if (weather === "mist") {
      if (id === FishMutation.Bunny) weight *= 2.0;
      if (id === FishMutation.Frozen) weight *= 3.0;
      if (id === FishMutation.Nuclear) weight *= 2.5;
      if (id === FishMutation.Ishmael) weight *= 2.5;
      if (id === FishMutation.Serene) weight *= 2.5;
      if (id === FishMutation.Abyssal) weight *= 2.5;
    }
    if (weather === "deep-clear") {
      if (id === FishMutation.Umbra) weight *= 3.5;
      if (id === FishMutation.Mythical) weight *= 4.0;
      if (id === FishMutation.RainbowCluster) weight *= 3.5;
      if (id === FishMutation.Serene) weight *= 3.0;
      if (id === FishMutation.Astraeus) weight *= 3.5;
      if (id === FishMutation.Abyssal) weight *= 4.5; // Oceanic Mariana trench synergy
    }
    if (weather === "sunset") {
      if (id === FishMutation.Umbra) weight *= 2.5;
      if (id === FishMutation.Midas) weight *= 3.0;
      if (id === FishMutation.Ishmael) weight *= 2.5; // Sunset ginger synergy
      if (id === FishMutation.Astraeus) weight *= 4.0; // Titan of dusk / twilight
    }
    if (weather === "sunny") {
      if (id === FishMutation.Midas) weight *= 3.5;
    }
    if (weather === "overcast") {
      if (id === FishMutation.Electric) weight *= 2.5;
      if (id === FishMutation.Nuclear) weight *= 3.0;
      if (id === FishMutation.Abyssal) weight *= 2.5;
    }

    weightedList.push({ id, weight });
    totalWeight += weight;
  }

  let threshold = random.range(0, totalWeight);
  for (const entry of weightedList) {
    if (threshold <= entry.weight) {
      return entry.id;
    }
    threshold -= entry.weight;
  }

  return mutationKeys[0];
}

export function applyMutationColors(
  baseColor: THREE.Color,
  accentColor: THREE.Color,
  markingColor: THREE.Color,
  finColor: THREE.Color,
  eyeColor: THREE.Color,
  mutation: FishMutation,
  simulationTime: number,
): void {
  if (mutation === FishMutation.None) return;

  if (mutation === FishMutation.Aurora) {
    // Fisch visual effect: "Causes the fish to glow with a mix of blue and green"
    const wave = (Math.sin(simulationTime * 1.6) + 1) * 0.5; // [0, 1]
    const hueBase = 0.40 + wave * 0.14; // oscillates between green (~0.40) and cyan-blue (~0.54)
    const hueAccent = 0.54 - wave * 0.14;

    baseColor.setHSL(hueBase, 0.95, 0.58);
    accentColor.setHSL(hueAccent, 0.95, 0.55);
    markingColor.setHSL(0.5, 0.92, 0.72);
    finColor.setHSL(hueBase, 0.88, 0.68);
    eyeColor.setRGB(0.9, 1.0, 1.0);
    return;
  }

  if (mutation === FishMutation.Umbra) {
    // Fisch visual effect: Celestial Eclipse with vibrant dual-tone neon luminescence
    const neonPulse = 0.5 + 0.5 * Math.sin(simulationTime * 2.8);
    // Base: Deep dark obsidian indigo-violet with subtle neon resonance
    baseColor.setRGB(0.08, 0.06, 0.16);
    // Accent: Intense Radiant Solar Neon Amber/Gold
    accentColor.setRGB(1.0, 0.74 + 0.14 * neonPulse, 0.05);
    // Marking: Intense Radiant Ultraviolet Neon Lavender/Periwinkle
    markingColor.setRGB(0.55 + 0.08 * neonPulse, 0.50, 1.0);
    // Fin: Glowing Periwinkle Violet with Neon Edge
    finColor.setRGB(0.50, 0.44, 0.96);
    // Eye: Pure radiant solar golden white
    eyeColor.setRGB(1.0, 0.96, 0.52);
    return;
  }

  if (mutation === FishMutation.Midas) {
    // Pure gleaming 24K gold with shimmering specular sheen
    const shimmer = 0.88 + 0.12 * Math.sin(simulationTime * 3.2);
    baseColor.setRGB(0.96 * shimmer, 0.62 * shimmer, 0.04 * shimmer);
    accentColor.setRGB(1.0, 0.82, 0.18);
    markingColor.setRGB(0.85, 0.48, 0.02);
    finColor.setRGB(0.99, 0.90, 0.54);
    eyeColor.setRGB(1.0, 0.98, 0.88);
    return;
  }

  if (mutation === FishMutation.Electric) {
    // Midnight storm navy with crackling neon cyan and electric violet
    const sparkPulse = 0.75 + 0.25 * Math.sin(simulationTime * 16.0);
    baseColor.setRGB(0.04, 0.07, 0.17);
    accentColor.setRGB(0.0, 0.96 * sparkPulse, 1.0 * sparkPulse);
    markingColor.setRGB(0.44 * sparkPulse, 0.0, 1.0);
    finColor.setRGB(0.0, 0.70 * sparkPulse, 0.95);
    eyeColor.setRGB(0.9, 0.98, 1.0);
    return;
  }

  if (mutation === FishMutation.Nuclear) {
    // Hazardous toxic sludge with pulsating nuclear lime core
    const toxicPulse = 0.5 + 0.5 * Math.sin(simulationTime * 4.2);
    baseColor.setRGB(0.05, 0.16, 0.09);
    accentColor.setRGB(0.22, 1.0, 0.08 + 0.12 * toxicPulse);
    markingColor.setRGB(0.44, 0.88 + 0.12 * toxicPulse, 0.0);
    finColor.setRGB(0.0, 1.0, 0.53);
    eyeColor.setRGB(0.22, 1.0, 0.08);
    return;
  }

  if (mutation === FishMutation.Mythical) {
    // Continuous dynamic chromatic rainbow spectrum
    const baseHue = (simulationTime * 0.22) % 1;
    baseColor.setHSL(baseHue, 0.95, 0.58);
    accentColor.setHSL((baseHue + 0.33) % 1, 0.95, 0.55);
    markingColor.setHSL((baseHue + 0.66) % 1, 0.95, 0.62);
    finColor.setHSL((baseHue + 0.15) % 1, 0.90, 0.68);
    eyeColor.setRGB(1.0, 1.0, 1.0);
    return;
  }

  if (mutation === FishMutation.RainbowCluster) {
    // Soft glowing pastel rainbow iridescent flow
    const pastelHue = (simulationTime * 0.16) % 1;
    baseColor.setHSL(pastelHue, 0.70, 0.82);
    accentColor.setHSL((pastelHue + 0.25) % 1, 0.75, 0.78);
    markingColor.setHSL((pastelHue + 0.50) % 1, 0.75, 0.80);
    finColor.setHSL((pastelHue + 0.75) % 1, 0.68, 0.85);
    eyeColor.setRGB(1.0, 0.98, 1.0);
    return;
  }

  if (mutation === FishMutation.Ishmael) {
    // Warm vibrant ginger-orange with subtle aquatic luster
    const luster = 0.95 + 0.05 * Math.sin(simulationTime * 2.2);
    baseColor.setRGB(0.90 * luster, 0.44 * luster, 0.26 * luster);
    accentColor.setRGB(0.74, 0.32, 0.16);
    markingColor.setRGB(0.26, 0.14, 0.08); // Leather brown headband
    finColor.setRGB(0.86, 0.41, 0.24);
    eyeColor.setRGB(0.48, 0.40, 0.22); // Hazel-olive anime iris
    return;
  }

  if (mutation === FishMutation.Serene) {
    // Polaris Serenade: Deep midnight navy with serene pulsating cyan/aquamarine ethereal light
    const pulse = 0.85 + 0.15 * Math.sin(simulationTime * 1.2);
    baseColor.setRGB(0.03, 0.07, 0.16);
    accentColor.setRGB(0.0, 1.0 * pulse, 0.88 * pulse);
    markingColor.setRGB(0.01, 0.52 * pulse, 0.78);
    finColor.setRGB(0.22, 0.74 * pulse, 0.97);
    eyeColor.setRGB(0.85, 1.0, 1.0);
    return;
  }

  if (mutation === FishMutation.Astraeus) {
    // Astraeus Serenade: Cosmic twilight royal violet with soothing dusk-orange solar breathing
    const duskPulse = 0.5 + 0.5 * Math.sin(simulationTime * 1.3);
    baseColor.setRGB(0.10, 0.03, 0.17);
    accentColor.setRGB(1.0, 0.55 + 0.15 * duskPulse, 0.0); // Fiery solar dusk-orange
    markingColor.setRGB(0.75 + 0.15 * duskPulse, 0.52, 0.98); // Ultraviolet twilight violet
    finColor.setRGB(0.58, 0.20, 0.92);
    eyeColor.setRGB(1.0, 0.92, 0.82);
    return;
  }

  if (mutation === FishMutation.Abyssal) {
    // Fisch visual effect: Deep oceanic trench bioluminescence oscillating between bright blue (#0c0fd4) and royal purple (#7950f2)
    const wave = 0.5 + 0.5 * Math.sin(simulationTime * 1.5);
    // Dynamic Hue shift: 0.64 (Abyssal sapphire blue ~230°) to 0.76 (Abyssal royal purple/violet ~274°)
    const hueBase = 0.64 + 0.12 * wave;
    const hueAccent = 0.76 - 0.12 * wave;
    baseColor.setHSL(hueBase, 0.95, 0.28 + 0.14 * wave);
    accentColor.setHSL(hueAccent, 0.95, 0.56 + 0.12 * wave);
    // Marking: Radiant hydrothermal neon cyan photophores
    markingColor.setRGB(0.0, 0.82 + 0.18 * wave, 1.0);
    // Fin: Luminous abyssal indigo-violet
    finColor.setHSL(0.68 + 0.06 * wave, 0.85, 0.44 + 0.10 * wave);
    // Eye: Eerie glowing deep-sea photophore eye
    eyeColor.setRGB(0.35, 0.92, 1.0);
    return;
  }

  const def = MUTATION_DEFINITIONS[mutation];
  if (!def) return;

  baseColor.set(def.colors.base);
  accentColor.set(def.colors.accent);
  markingColor.set(def.colors.marking);
  finColor.set(def.colors.fin);
  eyeColor.set(def.colors.eye);
}
