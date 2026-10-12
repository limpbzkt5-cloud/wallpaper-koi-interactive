export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (value: Vec2, scalar: number): Vec2 => ({
  x: value.x * scalar,
  y: value.y * scalar,
});
export const lerp = (a: Vec2, b: Vec2, amount: number): Vec2 =>
  add(a, mul(sub(b, a), amount));
export const length = (value: Vec2): number => Math.hypot(value.x, value.y);
export const normalize = (value: Vec2, fallback: Vec2 = vec(1, 0)): Vec2 => {
  const magnitude = length(value);
  return magnitude > 0.0001 ? mul(value, 1 / magnitude) : { ...fallback };
};
export const fromAngle = (angle: number): Vec2 => vec(Math.cos(angle), Math.sin(angle));
export const perpendicular = (value: Vec2): Vec2 => vec(-value.y, value.x);
export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));
export const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class XorShift32 {
  public state: number;

  public constructor(seed = 0x00c0ffee) {
    this.state = seed >>> 0;
  }

  public next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  public unit(): number {
    return (this.next() & 0x00ffffff) / 0x01000000;
  }

  public range(low: number, high: number): number {
    return low + (high - low) * this.unit();
  }
}
