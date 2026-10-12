import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_RIPPLES,
  RIPPLES,
} from "./config";
import { clamp, type Vec2, vec, XorShift32 } from "./math";

export type RippleType = keyof typeof RIPPLES.types;

export interface RippleInstance {
  center: Vec2;
  age: number;
  strength: number;
  type: RippleType;
  alive: boolean;
}

export const RIPPLE_TYPE_ORDER = Object.keys(
  RIPPLES.types,
) as RippleType[];

const RIPPLE_PRIORITY: Record<RippleType, number> = {
  rain: 0,
  mouth: 1,
  touch: 2,
};

export class RippleSystem {
  public readonly instances: RippleInstance[] = Array.from(
    { length: MAX_RIPPLES },
    () => ({
      center: vec(),
      age: 0,
      strength: 0,
      type: "touch",
      alive: false,
    }),
  );

  private readonly random = new XorShift32(0x7a11fa11);
  private rainIntensity = 0;
  private rainCountdown = 0;

  public trigger(type: RippleType, point: Vec2): void {
    const profile = RIPPLES.types[type];
    const rippleCount = Math.min(
      profile.ripplesPerEvent,
      profile.maximumActive,
    );

    for (let index = 0; index < rippleCount; index += 1) {
      const ripple = this.allocate(type);
      if (!ripple) break;
      ripple.center = { ...point };
      ripple.age = -index * profile.intervalSeconds;
      ripple.strength =
        profile.initialStrength * Math.pow(profile.strengthFalloff, index);
      ripple.type = type;
      ripple.alive = true;
    }
  }

  public setRainIntensity(intensity: number): void {
    this.rainIntensity = clamp(intensity, 0, 1);
    if (this.rainIntensity <= 0) this.rainCountdown = 0;
  }

  public update(deltaTime: number): void {
    for (const ripple of this.instances) {
      if (!ripple.alive) continue;
      ripple.age += deltaTime;
      if (ripple.age > RIPPLES.types[ripple.type].lifetime) {
        ripple.alive = false;
      }
    }

    if (this.rainIntensity <= 0) return;
    const rainEmitter = RIPPLES.rainEmitter;
    this.rainCountdown -= deltaTime;
    let emitted = 0;
    while (
      this.rainCountdown <= 0
      && emitted < rainEmitter.maximumDropsPerFrame
    ) {
      this.trigger("rain", {
        x: this.random.range(
          rainEmitter.edgeMargin,
          CANVAS_WIDTH - rainEmitter.edgeMargin,
        ),
        y: this.random.range(
          rainEmitter.edgeMargin,
          CANVAS_HEIGHT - rainEmitter.edgeMargin,
        ),
      });
      const averageInterval = 1 / Math.max(rainEmitter.dropsPerSecond, 0.1);
      const variation = Math.max(0, rainEmitter.frequencyVariation);
      const intervalMultiplier = this.random.range(
        Math.max(0.05, 1 - variation),
        1 + variation,
      );
      this.rainCountdown +=
        averageInterval * intervalMultiplier
        / Math.max(this.rainIntensity, 0.12);
      emitted += 1;
    }
  }

  public reset(): void {
    for (const ripple of this.instances) ripple.alive = false;
    this.random.state = 0x7a11fa11;
    this.rainCountdown = 0;
  }

  private allocate(type: RippleType): RippleInstance | undefined {
    const maximumActive = RIPPLES.types[type].maximumActive;
    let activeOfType = 0;
    let oldestOfType: RippleInstance | undefined;
    let available: RippleInstance | undefined;

    for (const ripple of this.instances) {
      if (!ripple.alive) {
        available ??= ripple;
        continue;
      }
      if (ripple.type !== type) continue;
      activeOfType += 1;
      if (!oldestOfType || ripple.age > oldestOfType.age) {
        oldestOfType = ripple;
      }
    }

    if (activeOfType >= maximumActive) return oldestOfType;
    if (available) return available;

    let replacement: RippleInstance | undefined;
    let replacementPriority = Number.POSITIVE_INFINITY;
    for (const ripple of this.instances) {
      const priority = RIPPLE_PRIORITY[ripple.type];
      if (priority > RIPPLE_PRIORITY[type]) continue;
      if (
        priority < replacementPriority ||
        (priority === replacementPriority &&
          (!replacement || ripple.age > replacement.age))
      ) {
        replacement = ripple;
        replacementPriority = priority;
      }
    }
    return replacement;
  }
}
