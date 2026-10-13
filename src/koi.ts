import { CANVAS_HEIGHT, CANVAS_WIDTH, FISH, SPINE_NODES, TAU } from "./config";
import { add, fromAngle, mul, type Vec2, vec, XorShift32 } from "./math";
import { FishMutation, MUTATION_DEFINITIONS } from "./mutations";

export enum SwimState {
  Glide,
  Coast,
  Hover,
  Burst,
  Pivot,
}

export class Koi {
  public position = vec();
  public velocity = vec();
  public spine: Vec2[] = Array.from({ length: SPINE_NODES }, () => vec());
  public renderSpine: Vec2[] = Array.from({ length: SPINE_NODES }, () => vec());
  public heading = 0;
  public angularVelocity = 0;
  public speed = 0;
  public cruiseSpeed = 20;
  public maximumSpeed = 34;
  public turnStrength = 5;
  public bodyLength = 24;
  public bodyWidth = 4;
  public swimPhase = 0;
  public phaseOffset = 0;
  public wanderSeed = 0;
  public stateAge = 0;
  public stateDuration = 2;
  public pivotHeading = 0;
  public reactivity = 0.7;
  public callDelay = 0;
  public respondedToCall = false;
  public callResponseAge = 0;
  public tailEffort = 0.6;
  public depth = 0.08;
  public targetDepth = 0.08;
  public depthTransitionRate = 1;
  public depthStateAge = 0;
  public depthStateDuration = 10;
  public inDeepPeriod = false;
  public gulpCountdown = 8;
  public gulpAnimation = 0;
  public behaviorRng = 1;
  public state = SwimState.Glide;

  public mutation: FishMutation = FishMutation.None;
  public isVisitor = false;
  public visitorAge = 0;
  public visitorLifetime = 75;
  public isDeparting = false;
  public departTarget = vec();

  public baseCruiseSpeed = 20;
  public baseMaximumSpeed = 34;
  public baseBodyLength = 24;
  public baseBodyWidth = 4;

  public applyMutation(mutation: FishMutation): void {
    this.mutation = mutation;
    const def = MUTATION_DEFINITIONS[mutation];
    const speedScale = def && mutation !== FishMutation.None ? def.speedScale : 1.0;
    const sizeScale = def && mutation !== FishMutation.None ? def.sizeScale : 1.0;

    this.cruiseSpeed = this.baseCruiseSpeed * speedScale;
    this.maximumSpeed = this.baseMaximumSpeed * speedScale;
    this.bodyLength = this.baseBodyLength * sizeScale;
    this.bodyWidth = this.baseBodyWidth * sizeScale;
  }

  public reset(index: number, random: XorShift32): void {
    this.position = vec(
      random.range(45, CANVAS_WIDTH - 45),
      random.range(32, CANVAS_HEIGHT - 32),
    );
    this.heading = random.range(-Math.PI, Math.PI);
    this.cruiseSpeed = random.range(13, 21);
    this.maximumSpeed = this.cruiseSpeed * random.range(1.55, 1.9);
    this.speed = this.cruiseSpeed * random.range(0.72, 1.05);
    this.turnStrength = random.range(4.4, 6.8);
    const tiny = index % FISH.tinyEvery === FISH.tinyEvery - 1;
    const lengthRange = tiny ? FISH.tinyLength : FISH.regularLength;
    const widthRange = tiny ? FISH.tinyWidthRatio : FISH.regularWidthRatio;
    this.bodyLength = random.range(lengthRange[0], lengthRange[1]);
    this.bodyWidth = this.bodyLength * random.range(widthRange[0], widthRange[1]);
    this.baseBodyLength = this.bodyLength;
    this.baseBodyWidth = this.bodyWidth;
    this.baseCruiseSpeed = this.cruiseSpeed;
    this.baseMaximumSpeed = this.maximumSpeed;
    this.phaseOffset = random.range(0, TAU);
    this.swimPhase = this.phaseOffset;
    this.wanderSeed = random.range(0, 100);
    this.reactivity = random.range(0.35, 1);
    this.callDelay = 0;
    this.respondedToCall = false;
    this.callResponseAge = 0;
    this.behaviorRng = (0x9e3779b9 ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
    this.depth = random.range(FISH.depth.initialRange[0], FISH.depth.initialRange[1]);
    this.targetDepth = this.depth;
    this.depthTransitionRate = 3 / random.range(
      FISH.depth.transitionSeconds[0],
      FISH.depth.transitionSeconds[1],
    );
    this.depthStateDuration = random.range(
      FISH.depth.surfaceDurationSeconds[0],
      FISH.depth.surfaceDurationSeconds[1],
    );
    this.depthStateAge = random.range(0, this.depthStateDuration * 0.7);
    this.inDeepPeriod = false;
    this.gulpCountdown = random.range(
      FISH.feeding.intervalSeconds[0],
      FISH.feeding.intervalSeconds[1],
    );
    this.gulpAnimation = 0;
    this.state = index % 5;
    this.mutation = FishMutation.None;
    this.isVisitor = false;
    this.visitorAge = 0;
    this.visitorLifetime = 75;

    const durations: ReadonlyArray<readonly [number, number]> = [
      [1.7, 4.8],
      [0.8, 2],
      [0.7, 2.9],
      [0.35, 0.9],
      [0.35, 0.8],
    ];
    const [low, high] = durations[this.state];
    this.stateDuration = random.range(low, high);
    this.stateAge = random.range(0, this.stateDuration * 0.8);
    this.pivotHeading = this.heading;
    this.tailEffort = 0.6;
    this.angularVelocity = 0;
    this.velocity = mul(fromAngle(this.heading), this.speed);

    const backward = mul(fromAngle(this.heading), -this.bodyLength / (SPINE_NODES - 1));
    for (let node = 0; node < SPINE_NODES; node += 1) {
      this.spine[node] = add(this.position, mul(backward, node));
      this.renderSpine[node] = { ...this.spine[node] };
    }
  }

  public spawnAtEdge(random: XorShift32): void {
    const edge = Math.floor(random.range(0, 4));
    let x = 0;
    let y = 0;
    let angle = 0;
    if (edge === 0) {
      x = -15;
      y = random.range(25, CANVAS_HEIGHT - 25);
      angle = random.range(-0.35, 0.35);
    } else if (edge === 1) {
      x = CANVAS_WIDTH + 15;
      y = random.range(25, CANVAS_HEIGHT - 25);
      angle = Math.PI + random.range(-0.35, 0.35);
    } else if (edge === 2) {
      x = random.range(25, CANVAS_WIDTH - 25);
      y = -15;
      angle = Math.PI * 0.5 + random.range(-0.35, 0.35);
    } else {
      x = random.range(25, CANVAS_WIDTH - 25);
      y = CANVAS_HEIGHT + 15;
      angle = -Math.PI * 0.5 + random.range(-0.35, 0.35);
    }
    this.position = vec(x, y);
    this.heading = angle;
    this.pivotHeading = angle;
    this.depth = 0.08;
    this.targetDepth = 0.08;
    this.speed = this.cruiseSpeed * 1.25;
    this.isVisitor = true;
    this.visitorAge = 0;
    this.visitorLifetime = random.range(60, 90);
    this.velocity = mul(fromAngle(this.heading), this.speed);

    const backward = mul(fromAngle(this.heading), -this.bodyLength / (SPINE_NODES - 1));
    for (let node = 0; node < SPINE_NODES; node += 1) {
      this.spine[node] = add(this.position, mul(backward, node));
      this.renderSpine[node] = { ...this.spine[node] };
    }
  }

  public spawnAtEdgeForCycle(random: XorShift32): void {
    const edge = Math.floor(random.range(0, 4));
    let x = 0;
    let y = 0;
    let angle = 0;
    if (edge === 0) {
      x = -15;
      y = random.range(25, CANVAS_HEIGHT - 25);
      angle = random.range(-0.35, 0.35);
    } else if (edge === 1) {
      x = CANVAS_WIDTH + 15;
      y = random.range(25, CANVAS_HEIGHT - 25);
      angle = Math.PI + random.range(-0.35, 0.35);
    } else if (edge === 2) {
      x = random.range(25, CANVAS_WIDTH - 25);
      y = -15;
      angle = Math.PI * 0.5 + random.range(-0.35, 0.35);
    } else {
      x = random.range(25, CANVAS_WIDTH - 25);
      y = CANVAS_HEIGHT + 15;
      angle = -Math.PI * 0.5 + random.range(-0.35, 0.35);
    }
    this.position = vec(x, y);
    this.heading = angle;
    this.pivotHeading = angle;
    this.depth = 0.08;
    this.targetDepth = 0.08;
    this.speed = this.cruiseSpeed * 1.15;
    this.isVisitor = false;
    this.isDeparting = false;
    this.velocity = mul(fromAngle(this.heading), this.speed);

    const backward = mul(fromAngle(this.heading), -this.bodyLength / (SPINE_NODES - 1));
    for (let node = 0; node < SPINE_NODES; node += 1) {
      this.spine[node] = add(this.position, mul(backward, node));
      this.renderSpine[node] = { ...this.spine[node] };
    }
  }
}
