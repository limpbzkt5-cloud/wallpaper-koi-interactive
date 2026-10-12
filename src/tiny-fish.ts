import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  TINY_FISH,
  TINY_FISH_SCHOOLS,
  viewportPoint,
  type TinyFishSchoolSetting,
} from "./config";
import {
  add,
  clamp,
  fromAngle,
  length,
  mul,
  normalize,
  perpendicular,
  sub,
  vec,
  wrapAngle,
  type Vec2,
  XorShift32,
} from "./math";

export interface TinyFishAgent {
  position: Vec2;
  velocity: Vec2;
  bodyLength: number;
  bodyWidth: number;
  tailPhase: number;
  phase: number;
  palette: number;
  schoolIndex: number;
  cruiseSpeed: number;
  fleeDelay: number;
  fleeTime: number;
  fleeDuration: number;
}

interface TinySchoolRange {
  start: number;
  count: number;
  phase: number;
  setting: TinyFishSchoolSetting;
}

export class TinyFishSchools {
  public readonly fish: TinyFishAgent[] = [];

  private readonly ranges: TinySchoolRange[] = [];
  private readonly random = new XorShift32(0x51a7f15c);
  private callPoint = vec();

  public constructor() {
    this.reset();
  }

  public reset(): void {
    this.fish.length = 0;
    this.ranges.length = 0;
    this.random.state = 0x51a7f15c;

    for (const [schoolIndex, setting] of TINY_FISH_SCHOOLS.entries()) {
      const start = this.fish.length;
      const placement = viewportPoint(setting.x, setting.y);
      for (let index = 0; index < setting.count; index += 1) {
        const angle = this.random.range(0, Math.PI * 2);
        const radius = Math.sqrt(this.random.unit());
        const position = vec(
          placement.x + Math.cos(angle) * setting.spreadX * radius,
          placement.y + Math.sin(angle) * setting.spreadY * radius,
        );
        const heading = setting.heading + this.random.range(-0.34, 0.34);
        const bodyLength =
          this.random.range(TINY_FISH.bodyLength[0], TINY_FISH.bodyLength[1]) *
          setting.sizeScale;
        const cruiseSpeed =
          this.random.range(TINY_FISH.cruiseSpeed[0], TINY_FISH.cruiseSpeed[1]) *
          setting.speedScale;
        this.fish.push({
          position,
          velocity: mul(fromAngle(heading), cruiseSpeed),
          bodyLength,
          bodyWidth:
            bodyLength *
            this.random.range(
              TINY_FISH.bodyWidthRatio[0],
              TINY_FISH.bodyWidthRatio[1],
            ),
          tailPhase: this.random.range(0, Math.PI * 2),
          phase: this.random.range(0, Math.PI * 2),
          palette: setting.palette,
          schoolIndex,
          cruiseSpeed,
          fleeDelay: -1,
          fleeTime: 0,
          fleeDuration: TINY_FISH.flee.duration[0],
        });
      }
      this.ranges.push({
        start,
        count: setting.count,
        phase: this.random.range(0, Math.PI * 2),
        setting,
      });
    }
  }

  public refreshConfig(): void {
    const previous = new Map<string, TinyFishAgent>();
    for (const [schoolIndex, range] of this.ranges.entries()) {
      for (let index = 0; index < range.count; index += 1) {
        previous.set(`${schoolIndex}:${index}`, this.fish[range.start + index]);
      }
    }
    this.reset();
    for (const range of this.ranges) {
      for (let index = 0; index < range.count; index += 1) {
        const next = this.fish[range.start + index];
        const old = previous.get(`${next.schoolIndex}:${index}`);
        if (!old) continue;
        next.position = { ...old.position };
        next.velocity = { ...old.velocity };
        next.tailPhase = old.tailPhase;
        next.phase = old.phase;
        next.fleeDelay = old.fleeDelay;
        next.fleeTime = old.fleeTime;
        next.fleeDuration = old.fleeDuration;
      }
    }
  }

  public resize(scaleX: number, scaleY: number): void {
    for (const fish of this.fish) {
      fish.position.x *= scaleX;
      fish.position.y *= scaleY;
    }
    this.callPoint.x *= scaleX;
    this.callPoint.y *= scaleY;
  }

  public shiftSchool(schoolIndex: number, shiftX: number, shiftY: number): void {
    for (const fish of this.fish) {
      if (fish.schoolIndex !== schoolIndex) continue;
      fish.position.x += shiftX;
      fish.position.y += shiftY;
    }
  }

  public fleeFrom(point: Vec2): void {
    this.callPoint = { ...point };
    const visibleSchools = Math.min(
      TINY_FISH.visibleSchoolCount,
      this.ranges.length,
    );
    for (const fish of this.fish) {
      if (fish.schoolIndex >= visibleSchools) continue;
      const distance = length(sub(fish.position, point));
      if (distance > TINY_FISH.flee.reactionRadius) continue;
      fish.fleeDelay =
        distance / TINY_FISH.flee.propagationSpeed +
        this.random.range(0, TINY_FISH.flee.randomDelay);
      fish.fleeTime = 0;
      fish.fleeDuration = this.random.range(
        TINY_FISH.flee.duration[0],
        TINY_FISH.flee.duration[1],
      );
    }
  }

  public update(dt: number, time: number): void {
    const visibleSchools = Math.min(
      TINY_FISH.visibleSchoolCount,
      this.ranges.length,
    );
    for (let schoolIndex = 0; schoolIndex < visibleSchools; schoolIndex += 1) {
      this.updateSchool(this.ranges[schoolIndex], dt, time);
    }
  }

  private updateSchool(range: TinySchoolRange, dt: number, time: number): void {
    let center = vec();
    let averageVelocity = vec();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      center = add(center, this.fish[index].position);
      averageVelocity = add(averageVelocity, this.fish[index].velocity);
    }
    center = mul(center, 1 / range.count);
    averageVelocity = mul(averageVelocity, 1 / range.count);
    const schoolForward = normalize(
      averageVelocity,
      fromAngle(range.setting.heading),
    );

    for (let index = range.start; index < range.start + range.count; index += 1) {
      const fish = this.fish[index];
      if (fish.fleeDelay >= 0) {
        fish.fleeDelay -= dt;
        if (fish.fleeDelay <= 0) {
          fish.fleeDelay = -1;
          fish.fleeTime = fish.fleeDuration;
          const away = normalize(sub(fish.position, this.callPoint), schoolForward);
          fish.velocity = add(
            fish.velocity,
            mul(away, TINY_FISH.flee.initialImpulse),
          );
        }
      }

      let separation = vec();
      let alignment = vec();
      let cohesion = vec();
      let neighbours = 0;
      for (let other = range.start; other < range.start + range.count; other += 1) {
        if (other === index) continue;
        const offset = sub(fish.position, this.fish[other].position);
        const distance = length(offset);
        if (distance <= 0.001 || distance >= TINY_FISH.neighbourRadius) continue;
        neighbours += 1;
        cohesion = add(cohesion, this.fish[other].position);
        alignment = add(alignment, normalize(this.fish[other].velocity));
        if (distance < TINY_FISH.separationRadius) {
          separation = add(
            separation,
            mul(
              normalize(offset),
              (TINY_FISH.separationRadius - distance) /
                TINY_FISH.separationRadius,
            ),
          );
        }
      }

      const forward = normalize(fish.velocity, schoolForward);
      if (neighbours > 0) {
        cohesion = normalize(
          sub(mul(cohesion, 1 / neighbours), fish.position),
          schoolForward,
        );
        alignment = normalize(alignment, schoolForward);
      } else {
        cohesion = normalize(sub(center, fish.position), schoolForward);
        alignment = schoolForward;
      }

      const fromCenter = normalize(sub(fish.position, center), forward);
      const swirl = mul(
        perpendicular(fromCenter),
        range.setting.swirlDirection,
      );
      const wanderAngle =
        Math.atan2(forward.y, forward.x) +
        Math.sin(time * 0.62 + fish.phase + range.phase) * 0.58 +
        Math.sin(time * 0.19 + fish.phase * 1.7) * 0.31;
      let steering = add(
        mul(forward, 0.82),
        mul(fromAngle(wanderAngle), TINY_FISH.wanderStrength),
      );
      steering = add(
        steering,
        mul(cohesion, TINY_FISH.cohesionStrength),
      );
      steering = add(
        steering,
        mul(alignment, TINY_FISH.alignmentStrength),
      );
      steering = add(
        steering,
        mul(separation, TINY_FISH.separationStrength),
      );
      steering = add(steering, mul(swirl, TINY_FISH.swirlStrength));

      const edgeForce = vec();
      const margin = TINY_FISH.edgeMargin;
      if (fish.position.x < margin) {
        edgeForce.x += (margin - fish.position.x) / margin;
      }
      if (fish.position.x > CANVAS_WIDTH - margin) {
        edgeForce.x -=
          (fish.position.x - (CANVAS_WIDTH - margin)) / margin;
      }
      if (fish.position.y < margin) {
        edgeForce.y += (margin - fish.position.y) / margin;
      }
      if (fish.position.y > CANVAS_HEIGHT - margin) {
        edgeForce.y -=
          (fish.position.y - (CANVAS_HEIGHT - margin)) / margin;
      }
      let targetSpeed =
        fish.cruiseSpeed *
        (1 + Math.sin(time * 0.83 + fish.phase) * TINY_FISH.speedVariation);
      if (fish.fleeTime > 0) {
        fish.fleeTime = Math.max(0, fish.fleeTime - dt);
        const away = normalize(sub(fish.position, this.callPoint), forward);
        const schoolAway = normalize(sub(center, this.callPoint), away);
        steering = add(
          mul(away, TINY_FISH.flee.directionStrength),
          mul(schoolAway, TINY_FISH.flee.schoolingStrength),
        );
        steering = add(
          steering,
          mul(alignment, TINY_FISH.flee.schoolingStrength),
        );
        steering = add(
          steering,
          mul(separation, TINY_FISH.separationStrength),
        );
        targetSpeed = this.random.range(
          TINY_FISH.flee.speed[0],
          TINY_FISH.flee.speed[1],
        );
      }
      steering = add(steering, mul(edgeForce, TINY_FISH.edgeStrength));

      const desired = normalize(steering, forward);
      const currentHeading = Math.atan2(fish.velocity.y, fish.velocity.x);
      const desiredHeading = Math.atan2(desired.y, desired.x);
      const headingStep = clamp(
        wrapAngle(desiredHeading - currentHeading),
        -TINY_FISH.maximumTurnRate * dt,
        TINY_FISH.maximumTurnRate * dt,
      );
      const limitedDirection = fromAngle(currentHeading + headingStep);
      const response = 1 - Math.exp(-TINY_FISH.steeringResponse * dt);
      const currentSpeed = length(fish.velocity);
      const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * response;
      fish.velocity = mul(limitedDirection, nextSpeed);
      fish.position = add(fish.position, mul(fish.velocity, dt));
      fish.tailPhase += (4.4 + nextSpeed * 0.16) * dt;
    }
  }
}
