// Audio tuning. Volumes use the Web Audio gain scale: 0 is silent and 1 is full.
export const AUDIO = {
  defaultEnabled: false,
  toggleFadeSeconds: 0.45,
  ambient: {
    source: "audio/ambient-river-v1.m4a",
    volume: 0.3,
  },
} as const;
