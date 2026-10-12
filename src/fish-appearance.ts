import * as THREE from "three";
import {
  FISH,
  KOI_PALETTES,
  KOI_PATTERN_PATCHES,
  type KoiPatchSetting,
} from "./config";
import { FishMutation } from "./mutations";

export enum KoiPattern {
  Kohaku,
  Sanke,
  Showa,
  Ogon,
  Tancho,
  Shiro,
}

export interface FishAppearance {
  pattern: KoiPattern;
  base: THREE.Color;
  accent: THREE.Color;
  marking: THREE.Color;
  fin: THREE.Color;
  eye: THREE.Color;
  mutation?: FishMutation;
}

export const createFishAppearance = (index: number): FishAppearance => {
  const pattern = index % KOI_PALETTES.length;
  const palette = KOI_PALETTES[pattern];
  return {
    pattern,
    base: new THREE.Color(palette.base),
    accent: new THREE.Color(palette.accent),
    marking: new THREE.Color(palette.marking),
    fin: new THREE.Color(palette.fin),
    eye: new THREE.Color(FISH.eyeColor),
    mutation: FishMutation.None,
  };
};

export const patchesFor = (
  appearance: FishAppearance,
): readonly KoiPatchSetting[] => KOI_PATTERN_PATCHES[appearance.pattern];
