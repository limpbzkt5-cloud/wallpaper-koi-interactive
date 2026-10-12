// Audio tuning. Volumes use the Web Audio gain scale: 0 is silent and 1 is full.
export interface AudioTrackInfo {
  id: string;
  name: string;
  source: string;
  volume: number;
}

export const AUDIO_TRACKS: readonly AudioTrackInfo[] = [
  {
    id: "river-ambient",
    name: "River Serenade",
    source: "audio/ambient-river-v1.m4a",
    volume: 0.3,
  },
  {
    id: "calm-stream",
    name: "Calm Stream & Rills",
    source: "audio/ambient-river-v1.m4a",
    volume: 0.22,
  },
  {
    id: "deep-waters",
    name: "Deep Water Echoes",
    source: "audio/ambient-river-v1.m4a",
    volume: 0.38,
  },
] as const;

export const AUDIO = {
  defaultEnabled: false,
  toggleFadeSeconds: 0.45,
  ambient: {
    source: "audio/ambient-river-v1.m4a",
    volume: 0.3,
  },
} as const;
