import {
  CANVAS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  FISH,
  MAX_FISH,
  SPINE_NODES,
} from "./config";
import { Koi, SwimState } from "./koi";
import { FishMutation, rollMutation } from "./mutations";
import { TinyFishSchools } from "./tiny-fish";
import {
  add,
  clamp,
  fromAngle,
  length,
  lerp,
  mul,
  normalize,
  perpendicular,
  sub,
  type Vec2,
  vec,
  wrapAngle,
  XorShift32,
} from "./math";
import { RippleSystem } from "./ripple-system";
import type { WeatherPresetId } from "./weather";

export class School {
  public readonly fish: Koi[] = Array.from({ length: MAX_FISH + 2 }, () => new Koi());
  public readonly ripples = new RippleSystem();
  public readonly tinyFish = new TinyFishSchools();

  public count: number = FISH.initialCount;
  public targetActive = false;

  // Post-click and post-feeding dispersal scatter timers
  public clickScatterCountdown = -1;
  public foodScatterCountdown = -1;
  public scatterDecay = 0;
  public scatterDuration = 6.0;
  public scatterCenter: Vec2 | null = null;
  private lastFoodPos: Vec2 | null = null;
  private hadFoodPellets = false;

  public readonly maxVisitors = 2;
  public readonly visitorIndices = [MAX_FISH, MAX_FISH + 1];
  public visitorActive: boolean[] = [false, false];
  public visitorFrequencySeconds = 180;
  public readonly maxPerMutation = 2;

  public enabledMutations: Record<FishMutation, boolean> = {
    [FishMutation.None]: true,
    [FishMutation.Crimson]: false,
    [FishMutation.Bunny]: false,
    [FishMutation.Aurora]: false,
    [FishMutation.Umbra]: false,
    [FishMutation.Midas]: false,
    [FishMutation.Electric]: false,
    [FishMutation.Frozen]: false,
    [FishMutation.Nuclear]: false,
    [FishMutation.Mythical]: false,
    [FishMutation.RainbowCluster]: false,
    [FishMutation.Ishmael]: false,
    [FishMutation.Serene]: false,
    [FishMutation.Astraeus]: false,
    [FishMutation.Abyssal]: false,
  };
  public visitorCountdown = 60;
  public cycleIntervalSeconds = 120;
  public cycleCountdown = 120;
  public mutationChance = 0.70;
  public currentWeather: WeatherPresetId = "sunny";

  private random = new XorShift32();
  private target = vec(CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.5);
  private targetAge = 0;

  public constructor() {
    this.loadMutationPreferences();
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
    this.reseedMutations(this.currentWeather);
  }

  private loadMutationPreferences(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        if (!window.localStorage.getItem("nagomi_mutations_default_off_v1")) {
          for (const mut of Object.values(FishMutation)) {
            if (mut === FishMutation.None) continue;
            window.localStorage.removeItem(`nagomi_allow_${mut}`);
          }
          window.localStorage.setItem("nagomi_mutations_default_off_v1", "true");
        }
        for (const mut of Object.values(FishMutation)) {
          if (mut === FishMutation.None) continue;
          const val = window.localStorage.getItem(`nagomi_allow_${mut}`);
          if (val !== null) {
            this.enabledMutations[mut] = val === "true";
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  public get isVisitorActive(): boolean {
    return this.visitorActive.some(Boolean);
  }

  public get visitorActiveCount(): number {
    return this.visitorActive.filter(Boolean).length;
  }

  public countMutation(mutation: FishMutation): number {
    if (mutation === FishMutation.None) return 0;
    let count = 0;
    const active = this.activeIndices();
    for (const index of active) {
      if (this.fish[index].mutation === mutation) {
        count += 1;
      }
    }
    return count;
  }

  public activeIndices(): number[] {
    const list: number[] = [];
    for (let i = 0; i < this.count; i += 1) {
      list.push(i);
    }
    if (this.visitorActive[0]) {
      list.push(this.visitorIndices[0]);
    }
    if (this.visitorActive[1]) {
      list.push(this.visitorIndices[1]);
    }
    return list;
  }

  public enforceMutationCaps(): void {
    for (const m of Object.values(FishMutation)) {
      if (m === FishMutation.None) continue;
      while (this.countMutation(m) > this.maxPerMutation) {
        let cleared = false;
        const active = this.activeIndices();
        for (let i = active.length - 1; i >= 0; i--) {
          const idx = active[i];
          if (this.fish[idx].mutation === m) {
            this.fish[idx].applyMutation(FishMutation.None);
            cleared = true;
            break;
          }
        }
        if (!cleared) break;
      }
    }
  }

  public setMutationEnabled(mutation: FishMutation, enabled: boolean): void {
    this.enabledMutations[mutation] = enabled;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(`nagomi_allow_${mutation}`, enabled ? "true" : "false");
      }
    } catch {
      // Ignore
    }

    if (!enabled) {
      const eligibleMutations: Partial<Record<FishMutation, boolean>> = { ...this.enabledMutations };
      for (const key of Object.values(FishMutation)) {
        if (key !== FishMutation.None && this.countMutation(key) >= this.maxPerMutation) {
          eligibleMutations[key] = false;
        }
      }

      // Đổi ngay lập tức con cá có mutation này thành None hoặc mutation khác tùy vào RNG
      for (let i = 0; i < this.count; i += 1) {
        const fish = this.fish[i];
        if (fish.mutation === mutation) {
          const newMutation = rollMutation(
            this.random,
            this.currentWeather,
            this.mutationChance,
            false,
            eligibleMutations,
          );
          fish.applyMutation(newMutation);
          this.ripples.trigger("touch", fish.position);
        }
      }
      for (let s = 0; s < this.maxVisitors; s += 1) {
        const v = this.fish[this.visitorIndices[s]];
        if (v.mutation === mutation) {
          v.applyMutation(FishMutation.None);
          this.visitorActive[s] = false;
        }
      }
      this.enforceMutationCaps();
    }
  }

  public reseedMutations(weather: WeatherPresetId = this.currentWeather): void {
    for (let index = 0; index < this.count; index += 1) {
      this.fish[index].applyMutation(FishMutation.None);
    }
    for (const vIdx of this.visitorIndices) {
      this.fish[vIdx].applyMutation(FishMutation.None);
    }
    this.visitorActive = [false, false];

    const enabledList = (Object.keys(this.enabledMutations) as FishMutation[]).filter(
      (m) => m !== FishMutation.None && this.enabledMutations[m] === true,
    );

    // Always guarantee full diversity so each enabled mythical/celestial mutation is represented
    const guaranteeDiversity = enabledList.length > 0;

    if (guaranteeDiversity) {
      // Fisher-Yates shuffle enabledList
      const shuffled = [...enabledList];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.random.range(0, i + 1));
        const temp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = temp;
      }

      // Assign 1 of each distinct mutation to the first min(count, shuffled.length) fish
      const guaranteedCount = Math.min(this.count, shuffled.length);
      for (let i = 0; i < guaranteedCount; i += 1) {
        this.fish[i].applyMutation(shuffled[i]);
      }

      // For any remaining fish, roll with mutationChance respecting maxPerMutation
      for (let i = guaranteedCount; i < this.count; i += 1) {
        const eligibleMutations: Partial<Record<FishMutation, boolean>> = { ...this.enabledMutations };
        for (const key of Object.values(FishMutation)) {
          if (key !== FishMutation.None && this.countMutation(key) >= this.maxPerMutation) {
            eligibleMutations[key] = false;
          }
        }
        const mutation = rollMutation(
          this.random,
          weather,
          this.mutationChance,
          false,
          eligibleMutations,
        );
        this.fish[i].applyMutation(mutation);
      }
    } else {
      for (let index = 0; index < this.count; index += 1) {
        const fish = this.fish[index];
        const eligibleMutations: Partial<Record<FishMutation, boolean>> = { ...this.enabledMutations };
        for (const key of Object.values(FishMutation)) {
          if (key !== FishMutation.None && this.countMutation(key) >= this.maxPerMutation) {
            eligibleMutations[key] = false;
          }
        }
        const mutation = rollMutation(
          this.random,
          weather,
          this.mutationChance,
          false,
          eligibleMutations,
        );
        fish.applyMutation(mutation);
      }
    }
    this.enforceMutationCaps();
  }

  public spawnVisitor(
    weather: WeatherPresetId = this.currentWeather,
    forcedMutation?: FishMutation,
  ): void {
    let slot = 0;
    if (!this.visitorActive[0]) {
      slot = 0;
    } else if (!this.visitorActive[1]) {
      slot = 1;
    } else {
      const v0Age = this.fish[this.visitorIndices[0]].visitorAge;
      const v1Age = this.fish[this.visitorIndices[1]].visitorAge;
      slot = v0Age >= v1Age ? 0 : 1;
    }

    const visitorIndex = this.visitorIndices[slot];
    const visitor = this.fish[visitorIndex];
    visitor.reset(visitorIndex, this.random);
    visitor.spawnAtEdge(this.random);

    let mutation: FishMutation;
    if (forcedMutation && forcedMutation !== FishMutation.None) {
      if (this.enabledMutations[forcedMutation] === false) {
        return;
      }
      mutation = forcedMutation;
    } else {
      const enabledList = (Object.keys(this.enabledMutations) as FishMutation[]).filter(
        (m) => m !== FishMutation.None && this.enabledMutations[m] === true,
      );
      const missingMutations = enabledList.filter((m) => this.countMutation(m) === 0);

      if (
        missingMutations.length > 0 &&
        this.random.range(0, 1) < Math.min(1.0, this.mutationChance)
      ) {
        mutation = missingMutations[Math.floor(this.random.range(0, missingMutations.length))];
      } else {
        const eligibleMutations: Partial<Record<FishMutation, boolean>> = { ...this.enabledMutations };
        for (const key of Object.values(FishMutation)) {
          if (key !== FishMutation.None && this.countMutation(key) >= this.maxPerMutation) {
            eligibleMutations[key] = false;
          }
        }
        mutation = rollMutation(this.random, weather, 1.0, true, eligibleMutations);
      }
    }

    // Strictly enforce maxPerMutation (2) across the pond before applying
    if (mutation !== FishMutation.None && this.countMutation(mutation) >= this.maxPerMutation) {
      for (const idx of this.activeIndices()) {
        if (idx !== visitorIndex && this.fish[idx].mutation === mutation) {
          this.fish[idx].applyMutation(FishMutation.None);
          break;
        }
      }
    }

    visitor.applyMutation(mutation);
    this.visitorActive[slot] = true;
    this.ripples.trigger("touch", visitor.position);
    this.enforceMutationCaps();
  }

  public updateVisitor(dt: number, weather: WeatherPresetId): void {
    if (this.visitorFrequencySeconds <= 0) return;

    if (this.visitorActiveCount < this.maxVisitors) {
      this.visitorCountdown -= dt;
      if (this.visitorCountdown <= 0) {
        this.spawnVisitor(weather);
        const u = Math.max(0.001, this.random.range(0, 1));
        this.visitorCountdown = -Math.log(u) * this.visitorFrequencySeconds;
      }
    }

    for (let slot = 0; slot < this.maxVisitors; slot += 1) {
      if (this.visitorActive[slot]) {
        const visitor = this.fish[this.visitorIndices[slot]];
        visitor.visitorAge += dt;
        if (visitor.visitorAge >= visitor.visitorLifetime) {
          visitor.targetDepth = 1.0;
          visitor.depthTransitionRate = 1.5;
          if (visitor.depth >= 0.92) {
            this.visitorActive[slot] = false;
            visitor.applyMutation(FishMutation.None);
          }
        }
      }
    }
  }

  public transformRandomFish(targetMutation: FishMutation): void {
    let mutation = targetMutation;
    if (mutation === FishMutation.None || this.enabledMutations[mutation] === false) {
      const eligibleMutations: Partial<Record<FishMutation, boolean>> = { ...this.enabledMutations };
      for (const key of Object.values(FishMutation)) {
        if (key !== FishMutation.None && this.countMutation(key) >= this.maxPerMutation) {
          eligibleMutations[key] = false;
        }
      }
      mutation = rollMutation(this.random, this.currentWeather, 1.0, true, eligibleMutations);
    }

    if (mutation === FishMutation.None || this.enabledMutations[mutation] === false) {
      // If no valid mutation is enabled, revert 1 mutated fish to normal
      for (let i = 0; i < this.count; i += 1) {
        if (this.fish[i].mutation !== FishMutation.None) {
          this.fish[i].applyMutation(FishMutation.None);
          break;
        }
      }
      return;
    }

    // Ensure we don't exceed maxPerMutation (2)
    while (this.countMutation(mutation) >= this.maxPerMutation) {
      let cleared = false;
      for (const idx of this.activeIndices()) {
        if (this.fish[idx].mutation === mutation) {
          this.fish[idx].applyMutation(FishMutation.None);
          cleared = true;
          break;
        }
      }
      if (!cleared) break;
    }

    // Pick candidate from regular koi in the pond
    const candidates: number[] = [];
    for (let i = 0; i < this.count; i += 1) {
      if (this.fish[i].mutation !== mutation && !this.fish[i].isDeparting) {
        candidates.push(i);
      }
    }

    const idx = candidates.length > 0
      ? candidates[Math.floor(this.random.range(0, candidates.length))]
      : 0;

    const fish = this.fish[idx];
    fish.applyMutation(mutation);
    fish.speed = fish.maximumSpeed;
    this.enterState(fish, SwimState.Burst);
    this.ripples.trigger("touch", fish.position);
    this.ripples.trigger("mouth", fish.position);
    this.enforceMutationCaps();
  }

  public updateFishCycle(dt: number): void {
    if (this.cycleIntervalSeconds <= 0) return;

    this.cycleCountdown -= dt;
    if (this.cycleCountdown <= 0) {
      this.cycleCountdown = this.cycleIntervalSeconds;
      this.startFishCycle();
    }

    for (let i = 0; i < this.count; i += 1) {
      const fish = this.fish[i];
      if (fish.isDeparting) {
        const outX = fish.position.x < -20 || fish.position.x > CANVAS_WIDTH + 20;
        const outY = fish.position.y < -20 || fish.position.y > CANVAS_HEIGHT + 20;
        if (outX || outY) {
          fish.reset(i, this.random);
          fish.spawnAtEdgeForCycle(this.random);

          const enabledList = (Object.keys(this.enabledMutations) as FishMutation[]).filter(
            (m) => m !== FishMutation.None && this.enabledMutations[m] === true,
          );
          const missingMutations = enabledList.filter((m) => this.countMutation(m) === 0);

          let mutation: FishMutation = FishMutation.None;
          // Always prioritize filling a missing mutation so all mutations continuously swim in the pond!
          if (missingMutations.length > 0) {
            mutation = missingMutations[Math.floor(this.random.range(0, missingMutations.length))];
          } else {
            const eligibleMutations: Partial<Record<FishMutation, boolean>> = { ...this.enabledMutations };
            for (const key of Object.values(FishMutation)) {
              if (key !== FishMutation.None && this.countMutation(key) >= this.maxPerMutation) {
                eligibleMutations[key] = false;
              }
            }
            mutation = rollMutation(
              this.random,
              this.currentWeather,
              this.mutationChance,
              false,
              eligibleMutations,
            );
          }

          // Strictly enforce maxPerMutation (2) before applying
          if (mutation !== FishMutation.None && this.countMutation(mutation) >= this.maxPerMutation) {
            for (const idx of this.activeIndices()) {
              if (idx !== i && this.fish[idx].mutation === mutation) {
                this.fish[idx].applyMutation(FishMutation.None);
                break;
              }
            }
          }
          fish.applyMutation(mutation);
          this.ripples.trigger("touch", fish.position);
          this.enforceMutationCaps();
        }
      }
    }
  }

  public startFishCycle(): void {
    const candidates: number[] = [];
    for (let i = 0; i < this.count; i += 1) {
      if (!this.fish[i].isDeparting) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) return;

    // Weight candidates to protect sole representatives of mutations 70% of the time,
    // prioritizing cycling out normal fish or duplicate mutations:
    const weights: number[] = candidates.map((cIdx) => {
      const mut = this.fish[cIdx].mutation;
      if (mut === FishMutation.None) return 3.0;
      if (this.countMutation(mut) > 1) return 2.0;
      return 0.5;
    });

    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    let r = this.random.range(0, totalWeight);
    let idx = candidates[0];
    for (let c = 0; c < candidates.length; c += 1) {
      r -= weights[c];
      if (r <= 0) {
        idx = candidates[c];
        break;
      }
    }

    const fish = this.fish[idx];
    fish.isDeparting = true;

    const edge = Math.floor(this.random.range(0, 4));
    let targetX = 0;
    let targetY = 0;
    if (edge === 0) { targetX = -40; targetY = this.random.range(15, CANVAS_HEIGHT - 15); }
    else if (edge === 1) { targetX = CANVAS_WIDTH + 40; targetY = this.random.range(15, CANVAS_HEIGHT - 15); }
    else if (edge === 2) { targetX = this.random.range(15, CANVAS_WIDTH - 15); targetY = -40; }
    else { targetX = this.random.range(15, CANVAS_WIDTH - 15); targetY = CANVAS_HEIGHT + 40; }

    fish.departTarget = vec(targetX, targetY);
    fish.targetDepth = 0.85;
    fish.depthTransitionRate = 0.5;
  }

  public setCount(count: number): void {
    this.count = clamp(Math.round(count), 1, MAX_FISH);
  }

  public updateBodyProportions(previous: {
    regularLength: readonly [number, number];
    tinyLength: readonly [number, number];
    regularWidthRatio: readonly [number, number];
    tinyWidthRatio: readonly [number, number];
    tinyEvery: number;
  }): void {
    const midpoint = (range: readonly [number, number]): number =>
      (range[0] + range[1]) * 0.5;
    for (const [index, fish] of this.fish.entries()) {
      const wasTiny = index % previous.tinyEvery === previous.tinyEvery - 1;
      const isTiny = index % FISH.tinyEvery === FISH.tinyEvery - 1;
      const oldLength = midpoint(wasTiny ? previous.tinyLength : previous.regularLength);
      const newLength = midpoint(isTiny ? FISH.tinyLength : FISH.regularLength);
      const oldWidth = midpoint(
        wasTiny ? previous.tinyWidthRatio : previous.regularWidthRatio,
      );
      const newWidth = midpoint(isTiny ? FISH.tinyWidthRatio : FISH.regularWidthRatio);
      const lengthRatio = newLength / Math.max(oldLength, 0.001);
      fish.baseBodyLength *= lengthRatio;
      fish.baseBodyWidth *= (lengthRatio * newWidth) / Math.max(oldWidth, 0.001);
      fish.applyMutation(fish.mutation);
    }
  }

  public resize(scaleX: number, scaleY: number): void {
    const shiftX = (CANVAS_WIDTH - CANVAS.width) * 0.5;
    const shiftY = (CANVAS_HEIGHT - CANVAS.height) * 0.5;
    for (const fish of this.fish) {
      fish.position.x += shiftX;
      fish.position.y += shiftY;
      for (const node of fish.spine) {
        node.x += shiftX;
        node.y += shiftY;
      }
      for (const node of fish.renderSpine) {
        node.x += shiftX;
        node.y += shiftY;
      }
    }
    this.target.x *= scaleX;
    this.target.y *= scaleY;
    this.tinyFish.resize(scaleX, scaleY);
    for (const ripple of this.ripples.instances) {
      ripple.center.x *= scaleX;
      ripple.center.y *= scaleY;
    }
  }

  public reset(): void {
    this.random.state = 0x00c0ffee;
    this.fish.forEach((fish, index) => fish.reset(index, this.random));
    this.tinyFish.reset();
    this.ripples.reset();
    this.targetActive = false;
    this.visitorActive = [false, false];
    this.visitorCountdown = 60;
    this.cycleCountdown = this.cycleIntervalSeconds;
    this.reseedMutations(this.currentWeather);
  }

  public setRainIntensity(intensity: number): void {
    this.ripples.setRainIntensity(intensity);
  }

  public callTo(point: Vec2): void {
    this.target = { ...point };
    this.targetActive = true;
    this.targetAge = 0;
    this.clickScatterCountdown = 5.0; // Disperse fish after 5 seconds from click
    const active = this.activeIndices();
    for (const index of active) {
      const fish = this.fish[index];
      const response = FISH.callResponse;
      const distanceToCall = length(sub(fish.position, point));
      const distanceAmount = Math.pow(
        clamp(distanceToCall / response.distanceAtMaximumDelay, 0, 1),
        response.distanceExponent,
      );
      fish.callDelay =
        response.minimumDelaySeconds +
        distanceAmount * response.maximumDistanceDelaySeconds +
        this.random.range(0, response.randomJitterSeconds) +
        (1 - fish.reactivity) * response.temperamentDelaySeconds;
      fish.respondedToCall = false;
      fish.callResponseAge = 0;
    }
    this.tinyFish.fleeFrom(point);
    this.ripples.trigger("touch", point);
  }

  /**
   * Monitor food status from feeder boat.
   * Starts a 5.0-second scatter countdown immediately when all food pellets are consumed.
   */
  public notifyFoodStatus(floatingCount: number, centerPos?: Vec2): void {
    if (centerPos) {
      this.lastFoodPos = { ...centerPos };
    }
    if (floatingCount > 0) {
      this.hadFoodPellets = true;
      this.foodScatterCountdown = -1; // Reset while food is still being eaten
    } else if (this.hadFoodPellets) {
      // All food has just been consumed! Start 5.0s countdown to scatter
      this.hadFoodPellets = false;
      this.foodScatterCountdown = 5.0;
    }
  }

  /**
   * Disperse clustered fish radiating outwards across the pond,
   * breaking up dense gatherings gracefully.
   */
  public triggerClusterScatter(center?: Vec2): void {
    this.targetActive = false;
    this.scatterDuration = 6.0;
    this.scatterDecay = this.scatterDuration;
    this.scatterCenter = center ? { ...center } : null;

    const active = this.activeIndices();
    if (active.length === 0) return;

    let clusterCenter = center;
    if (!clusterCenter) {
      let sumX = 0;
      let sumY = 0;
      for (const idx of active) {
        sumX += this.fish[idx].position.x;
        sumY += this.fish[idx].position.y;
      }
      clusterCenter = vec(sumX / active.length, sumY / active.length);
    }

    // Gracefully wake any hovering fish into a calm swimming glide,
    // without snapping heading or speed so the animation remains buttery smooth
    for (const index of active) {
      const fish = this.fish[index];
      if (fish.state === SwimState.Hover || fish.state === SwimState.Coast) {
        this.enterState(fish, SwimState.Glide);
      }
    }
  }

  public scatter(): void {
    this.triggerClusterScatter();
  }

  public update(dt: number, time: number, weather?: WeatherPresetId): void {
    if (weather) this.currentWeather = weather;
    this.targetAge += dt;
    if (
      this.targetActive &&
      this.targetAge > FISH.callResponse.targetLifetimeSeconds
    ) {
      this.targetActive = false;
    }

    // 5-second automatic dispersal timer after user click
    if (this.clickScatterCountdown > 0) {
      this.clickScatterCountdown -= dt;
      if (this.clickScatterCountdown <= 0) {
        this.clickScatterCountdown = -1;
        this.triggerClusterScatter(this.target);
      }
    }

    // 5-second automatic dispersal timer after all food pellets are eaten
    if (this.foodScatterCountdown > 0) {
      this.foodScatterCountdown -= dt;
      if (this.foodScatterCountdown <= 0) {
        this.foodScatterCountdown = -1;
        this.triggerClusterScatter(this.lastFoodPos ?? undefined);
      }
    }

    // Decay the post-cluster dispersal forces smoothly
    if (this.scatterDecay > 0) {
      this.scatterDecay = Math.max(0, this.scatterDecay - dt);
    }

    this.updateVisitor(dt, this.currentWeather);
    this.updateFishCycle(dt);

    const active = this.activeIndices();
    const desired: Vec2[] = [];
    const desiredSpeed: number[] = [];
    for (const index of active) {
      const fish = this.fish[index];
      if (fish.mutation === FishMutation.Frozen) {
        this.updateFrozenDrift(fish, dt, time);
        continue;
      }
      fish.callDelay = Math.max(0, fish.callDelay - dt);
      if (this.targetActive && fish.respondedToCall) {
        fish.callResponseAge += dt;
      }
      if (this.targetActive && fish.callDelay <= 0 && !fish.respondedToCall) {
        fish.respondedToCall = true;
        fish.callResponseAge = 0;
        fish.targetDepth = FISH.depth.callRiseDepth;
        fish.depthTransitionRate = 3 / Math.max(FISH.depth.callRiseSeconds, 0.1);
        this.enterState(fish, SwimState.Burst);
      }
      this.updateNaturalState(fish, dt);
      this.updateDepth(fish, dt);
      this.updateFeeding(fish, dt);
      desired[index] = this.steeringFor(index, time);
      desiredSpeed[index] = this.desiredSpeedFor(index);
    }
    for (const index of active) {
      const fish = this.fish[index];
      if (fish.mutation === FishMutation.Frozen) {
        continue;
      }
      this.integrate(fish, desired[index], desiredSpeed[index], dt);
    }
    this.resolveFishCollisions(active, dt);
    this.tinyFish.update(dt, time);

    this.ripples.update(dt);
    this.enforceMutationCaps();
  }

  private updateFrozenDrift(fish: Koi, dt: number, time: number): void {
    // 1. Buoyancy: Ice block floats near surface, gently bobbing up and down
    fish.depth = 0.08 + 0.03 * Math.sin(time * 1.6 + fish.wanderSeed);
    fish.targetDepth = fish.depth;
    fish.inDeepPeriod = false;
    fish.gulpAnimation = 0;
    fish.tailEffort = 0;

    // 2. Slow ambient water current stream + gentle wandering drift
    const currentX =
      Math.cos(time * 0.22 + fish.wanderSeed * 0.3) * 4.2 +
      Math.sin(fish.position.y * 0.006) * 1.8;
    const currentY =
      Math.sin(time * 0.18 + fish.wanderSeed * 0.5) * 3.4 +
      Math.cos(fish.position.x * 0.006) * 1.5;

    let targetVelX = currentX;
    let targetVelY = currentY;

    // Ripple shockwave nudge: when user clicks or ripples hit the ice block
    if (this.targetActive) {
      const dx = fish.position.x - this.target.x;
      const dy = fish.position.y - this.target.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 120 && dist > 0.001) {
        const rippleForce = ((120 - dist) / 120) * 16.0;
        targetVelX += (dx / dist) * rippleForce;
        targetVelY += (dy / dist) * rippleForce;
      }
    }

    // Hydrodynamic viscous damping towards water current
    const drag = 1 - Math.exp(-1.4 * dt);
    fish.velocity.x += (targetVelX - fish.velocity.x) * drag;
    fish.velocity.y += (targetVelY - fish.velocity.y) * drag;
    fish.speed = Math.hypot(fish.velocity.x, fish.velocity.y);

    fish.position.x += fish.velocity.x * dt;
    fish.position.y += fish.velocity.y * dt;

    // 3. Elastic boundary bounce: ice cube physically rebounds off pond edges
    const margin = fish.bodyLength * 0.65;
    const restitution = 0.72;
    if (fish.position.x < margin) {
      fish.position.x = margin;
      fish.velocity.x = Math.abs(fish.velocity.x) * restitution;
    } else if (fish.position.x > CANVAS_WIDTH - margin) {
      fish.position.x = CANVAS_WIDTH - margin;
      fish.velocity.x = -Math.abs(fish.velocity.x) * restitution;
    }
    if (fish.position.y < margin) {
      fish.position.y = margin;
      fish.velocity.y = Math.abs(fish.velocity.y) * restitution;
    } else if (fish.position.y > CANVAS_HEIGHT - margin) {
      fish.position.y = CANVAS_HEIGHT - margin;
      fish.velocity.y = -Math.abs(fish.velocity.y) * restitution;
    }

    // 4. Slow passive angular tumble / rotation of the floating cube
    const tumbleRate = 0.09 * Math.sin(time * 0.35 + fish.wanderSeed);
    fish.heading = wrapAngle(fish.heading + tumbleRate * dt);
    fish.swimPhase = 0; // Frozen: no swimming phase

    // 5. Rigid spine: body is completely frozen solid inside the ice block
    fish.spine[0] = { ...fish.position };
    const backward = mul(fromAngle(fish.heading), -fish.bodyLength / (SPINE_NODES - 1));
    for (let node = 1; node < SPINE_NODES; node += 1) {
      fish.spine[node] = add(fish.position, mul(backward, node));
      fish.renderSpine[node] = { ...fish.spine[node] };
    }
  }

  private updateDepth(fish: Koi, dt: number): void {
    fish.depthStateAge += dt;
    const risingForCall = this.targetActive && fish.respondedToCall;
    if (!risingForCall && fish.depthStateAge >= fish.depthStateDuration) {
      fish.depthStateAge = 0;
      if (this.behaviorUnit(fish) < FISH.depth.changeProbability) {
        fish.inDeepPeriod = !fish.inDeepPeriod;
      }
      const range = fish.inDeepPeriod
        ? FISH.depth.deepRange
        : FISH.depth.shallowRange;
      const durations = fish.inDeepPeriod
        ? FISH.depth.deepDurationSeconds
        : FISH.depth.surfaceDurationSeconds;
      fish.targetDepth = this.behaviorRange(fish, range[0], range[1]);
      fish.depthStateDuration = this.behaviorRange(
        fish,
        durations[0],
        durations[1],
      );
      const transitionSeconds = this.behaviorRange(
        fish,
        FISH.depth.transitionSeconds[0],
        FISH.depth.transitionSeconds[1],
      );
      fish.depthTransitionRate = 3 / Math.max(transitionSeconds, 0.1);
    }

    fish.depth +=
      (fish.targetDepth - fish.depth) *
      (1 - Math.exp(-fish.depthTransitionRate * dt));
  }

  private updateFeeding(fish: Koi, dt: number): void {
    fish.gulpAnimation = Math.max(0, fish.gulpAnimation - dt);
    fish.gulpCountdown -= dt;
    if (fish.gulpCountdown > 0) return;

    const calmState =
      fish.state === SwimState.Hover ||
      fish.state === SwimState.Coast ||
      fish.state === SwimState.Glide;
    const chasing = this.targetActive && fish.respondedToCall;
    const eligible =
      calmState &&
      !chasing &&
      fish.depth <= FISH.feeding.eligibleDepth &&
      fish.speed <= fish.cruiseSpeed * FISH.feeding.eligibleSpeedFraction;

    if (!eligible) {
      fish.gulpCountdown = this.behaviorRange(
        fish,
        FISH.feeding.retryDelaySeconds[0],
        FISH.feeding.retryDelaySeconds[1],
      );
      return;
    }

    const forwardX = Math.cos(fish.heading);
    const forwardY = Math.sin(fish.heading);
    const mouthDistance = fish.bodyWidth * FISH.feeding.mouthForwardOffset;
    this.ripples.trigger("mouth", {
      x: fish.position.x + forwardX * mouthDistance,
      y: fish.position.y + forwardY * mouthDistance,
    });
    fish.gulpAnimation = FISH.feeding.animationDurationSeconds;
    fish.gulpCountdown = this.behaviorRange(
      fish,
      FISH.feeding.intervalSeconds[0],
      FISH.feeding.intervalSeconds[1],
    );
  }

  private behaviorUnit(fish: Koi): number {
    let value = fish.behaviorRng >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    fish.behaviorRng = value >>> 0;
    return (fish.behaviorRng & 0x00ffffff) / 0x01000000;
  }

  private behaviorRange(fish: Koi, low: number, high: number): number {
    return low + (high - low) * this.behaviorUnit(fish);
  }

  private enterState(fish: Koi, next: SwimState): void {
    fish.state = next;
    fish.stateAge = 0;
    switch (next) {
      case SwimState.Glide:
        fish.stateDuration = this.behaviorRange(fish, 1.7, 5.2);
        break;
      case SwimState.Coast:
        fish.stateDuration = this.behaviorRange(fish, 0.7, 2.1);
        break;
      case SwimState.Hover:
        fish.stateDuration = this.behaviorRange(fish, 0.65, 3.1);
        break;
      case SwimState.Burst:
        fish.stateDuration = this.behaviorRange(fish, 0.32, 0.92);
        break;
      case SwimState.Pivot: {
        fish.stateDuration = this.behaviorRange(fish, 0.3, 0.78);
        const direction = this.behaviorUnit(fish) < 0.5 ? -1 : 1;
        fish.pivotHeading = wrapAngle(
          fish.heading + direction * this.behaviorRange(fish, 0.85, 2.35),
        );
        break;
      }
    }
  }

  private updateNaturalState(fish: Koi, dt: number): void {
    fish.stateAge += dt;
    if (fish.stateAge < fish.stateDuration) return;

    const roll = this.behaviorUnit(fish);
    if (roll < 0.44) {
      this.enterState(fish, SwimState.Glide);
    } else if (roll < 0.69) {
      this.enterState(fish, SwimState.Coast);
    } else if (roll < 0.86) {
      this.enterState(fish, SwimState.Hover);
    } else if (roll < 0.94) {
      this.enterState(fish, SwimState.Burst);
    } else {
      this.enterState(fish, SwimState.Pivot);
    }
  }

  private steeringFor(index: number, time: number): Vec2 {
    const fish = this.fish[index];
    const forward = fromAngle(fish.heading);
    let steering = forward;

    if (fish.state === SwimState.Pivot) {
      const pivotDirection = fromAngle(fish.pivotHeading);
      const angleDifference = wrapAngle(fish.pivotHeading - fish.heading);
      if (Math.abs(angleDifference) < 0.22) {
        this.enterState(fish, SwimState.Glide);
        return forward;
      }
      return normalize(add(forward, mul(pivotDirection, 3.2)), forward);
    }

    // Smooth, peaceful post-gather dispersal envelope:
    // Uses a sine bell curve starting at 0, smoothly peaking at 0.48, and fading gracefully to 0
    let scatterIntensity = 0;
    if (this.scatterDecay > 0 && this.scatterDuration > 0) {
      const progress = clamp(1.0 - this.scatterDecay / this.scatterDuration, 0, 1);
      scatterIntensity = Math.sin(Math.PI * progress) * 0.48;
    }

    if (fish.state === SwimState.Hover) {
      const drift =
        Math.sin(time * 0.45 + fish.wanderSeed) * 0.22 +
        Math.cos(time * 0.18 + fish.wanderSeed * 0.7) * 0.15;
      steering = add(steering, mul(fromAngle(fish.heading + drift), 0.35));
    } else {
      const wander =
        Math.sin(time * 0.55 + fish.wanderSeed) * 0.62 +
        Math.cos(time * 0.23 + fish.wanderSeed * 1.3) * 0.38;
      const wanderWeight = 0.62 + 0.30 * scatterIntensity;
      steering = add(steering, mul(fromAngle(fish.heading + wander), wanderWeight));
    }

    let separation = vec();
    let alignment = vec();
    let cohesion = vec();
    let neighbours = 0;
    let obstacleRepulsion = vec();

    const others = this.activeIndices();
    for (const other of others) {
      if (other === index) continue;
      const otherFish = this.fish[other];
      const offset = sub(fish.position, otherFish.position);
      const distance = length(offset);
      if (distance < 0.001) continue;

      const deltaDepth = Math.abs(fish.depth - otherFish.depth);

      // 1. Obstacle avoidance if the other fish is frozen inside an ice cube
      if (otherFish.mutation === FishMutation.Frozen) {
        const iceCenter = lerp(otherFish.position, otherFish.spine[SPINE_NODES - 1], 0.5);
        const iceOffset = sub(fish.position, iceCenter);
        const iceDist = length(iceOffset);
        const iceAvoidRadius = Math.max(52, otherFish.bodyLength * 0.95);
        if (iceDist < iceAvoidRadius && deltaDepth < 0.30) {
          const depthWeight = Math.pow(Math.max(0, 1 - deltaDepth / 0.30), 2);
          const pushWeight = (iceAvoidRadius - iceDist) / iceAvoidRadius;
          const radial = normalize(iceOffset, forward);
          // Radial repulsion
          obstacleRepulsion = add(
            obstacleRepulsion,
            mul(radial, pushWeight * pushWeight * 7.5 * depthWeight),
          );
          // Tangential deflection to steer smoothly around the block
          const tangent = perpendicular(radial);
          const cross = forward.x * radial.y - forward.y * radial.x;
          const side = cross >= 0 ? 1 : -1;
          obstacleRepulsion = add(
            obstacleRepulsion,
            mul(tangent, side * pushWeight * 3.6 * depthWeight),
          );
        }
        // Do not cohere or align with a frozen ice block
        continue;
      }

      // 2. Normal schooling and depth-weighted separation (dynamically and gently expanded during scatter)
      const neighbourRadius = 42 + 12 * scatterIntensity;
      if (distance < neighbourRadius) {
        neighbours += 1;
        cohesion = add(cohesion, otherFish.position);
        alignment = add(alignment, normalize(otherFish.velocity, forward));

        const comfortRadius = 26 + 10 * scatterIntensity;
        const closeRadius = 14 + 5 * scatterIntensity;
        if (distance < comfortRadius && deltaDepth < 0.22) {
          const depthWeight = Math.pow(Math.max(0, 1 - deltaDepth / 0.22), 2);
          const linearPush = (comfortRadius - distance) / comfortRadius;
          const emergencyPush = closeRadius / Math.max(distance, 2.5);
          const pushMagnitude = (linearPush + emergencyPush * 0.75) * depthWeight * (1 + 0.35 * scatterIntensity);
          separation = add(separation, mul(normalize(offset, forward), pushMagnitude));
        }
      }
    }

    if (neighbours > 0) {
      cohesion = normalize(sub(mul(cohesion, 1 / neighbours), fish.position), forward);
      alignment = normalize(alignment, forward);
      const cohesionWeight = 0.22 * (1.0 - 0.40 * scatterIntensity);
      const alignmentWeight = 0.38 * (1.0 - 0.20 * scatterIntensity);
      const sepWeight = 3.2 + 1.1 * scatterIntensity;
      steering = add(steering, mul(cohesion, cohesionWeight));
      steering = add(steering, mul(alignment, alignmentWeight));
      steering = add(steering, mul(separation, sepWeight));
    } else if (length(separation) > 0.001) {
      steering = add(steering, mul(separation, 3.2 + 1.1 * scatterIntensity));
    }

    // 3. Smooth, gentle radial guidance away from cluster center
    if (this.scatterCenter && scatterIntensity > 0.01) {
      const fromCenter = sub(fish.position, this.scatterCenter);
      const dist = length(fromCenter);
      if (dist < 140) {
        const falloff = 1.0 - dist / 140;
        const push = falloff * scatterIntensity * 1.2;
        steering = add(steering, mul(normalize(fromCenter, forward), push));
      }
    }

    if (length(obstacleRepulsion) > 0.001) {
      steering = add(steering, obstacleRepulsion);
    }

    if (fish.isDeparting) {
      const toExit = sub(fish.departTarget, fish.position);
      return normalize(toExit, forward);
    }

    const margin = 32;
    const edgeForce = vec();
    if (fish.position.x < margin) edgeForce.x += (margin - fish.position.x) / margin;
    if (fish.position.x > CANVAS_WIDTH - margin) {
      edgeForce.x -= (fish.position.x - (CANVAS_WIDTH - margin)) / margin;
    }
    if (fish.position.y < margin) edgeForce.y += (margin - fish.position.y) / margin;
    if (fish.position.y > CANVAS_HEIGHT - margin) {
      edgeForce.y -= (fish.position.y - (CANVAS_HEIGHT - margin)) / margin;
    }
    steering = add(steering, mul(edgeForce, 4.8));

    if (this.targetActive && fish.callDelay <= 0) {
      const toTarget = sub(this.target, fish.position);
      const distance = length(toTarget);
      if (distance > 13) {
        const chasePull =
          fish.callResponseAge < FISH.callResponse.chaseBoostSeconds
            ? 3.35
            : 2.45;
        steering = add(steering, mul(normalize(toTarget), chasePull));
      } else {
        const targetDirection = normalize(toTarget, forward);
        steering = add(steering, mul(perpendicular(targetDirection), 2.2));
        steering = add(steering, mul(targetDirection, -0.5));
      }
    }

    return normalize(steering, forward);
  }

  private desiredSpeedFor(index: number): number {
    const fish = this.fish[index];
    if (fish.isDeparting) {
      return fish.cruiseSpeed * 1.35;
    }
    const chaseDuration = FISH.callResponse.chaseBoostSeconds;
    const chasing =
      this.targetActive &&
      fish.respondedToCall &&
      fish.callResponseAge < chaseDuration;
    if (chasing) {
      const chaseFade = 1 - clamp(fish.callResponseAge / chaseDuration, 0, 1);
      return (
        fish.maximumSpeed *
        (FISH.callResponse.chaseSpeedMultiplier +
          chaseFade * FISH.callResponse.initialExtraSpeedMultiplier)
      );
    }

    let intention = fish.cruiseSpeed;
    if (this.targetActive && fish.callDelay <= 0) {
      const distance = length(sub(this.target, fish.position));
      const urgency = clamp(distance / 105, 0.2, 1);
      intention = fish.cruiseSpeed + (fish.maximumSpeed - fish.cruiseSpeed) * urgency;
    }

    switch (fish.state) {
      case SwimState.Glide:
        return intention;
      case SwimState.Coast:
        return intention * 0.28;
      case SwimState.Hover:
        return 0;
      case SwimState.Burst:
        return fish.maximumSpeed * 1.08;
      case SwimState.Pivot:
        return fish.cruiseSpeed * 0.36;
    }
  }

  private integrate(fish: Koi, desired: Vec2, desiredSpeed: number, dt: number): void {
    const desiredHeading = Math.atan2(desired.y, desired.x);
    const headingError = wrapAngle(desiredHeading - fish.heading);
    const pivoting = fish.state === SwimState.Pivot;
    const turnMultiplier = pivoting ? 1.75 : 1.0;
    const angularDamping = pivoting ? 3.2 : 4.0;
    const angularAcceleration =
      headingError * fish.turnStrength * turnMultiplier - fish.angularVelocity * angularDamping;
    fish.angularVelocity += angularAcceleration * dt;
    const maximumTurnRate = pivoting ? 2.5 : 1.95;
    fish.angularVelocity = clamp(fish.angularVelocity, -maximumTurnRate, maximumTurnRate);
    fish.heading = wrapAngle(fish.heading + fish.angularVelocity * dt);

    const speedResponse =
      desiredSpeed > fish.speed
        ? pivoting
          ? 3.2
          : 5.6
        : pivoting
          ? 2.1
          : 3.2;

    let desiredTailEffort = clamp(
      (fish.speed / Math.max(fish.cruiseSpeed, 0.001)) * 0.58 +
        (Math.abs(fish.angularVelocity) / 2.2) * 0.35,
      0.08,
      1,
    );
    switch (fish.state) {
      case SwimState.Glide:
        desiredTailEffort = Math.min(desiredTailEffort, 0.68);
        break;
      case SwimState.Coast:
        desiredTailEffort = 0.12;
        break;
      case SwimState.Hover:
        desiredTailEffort = 0.05;
        break;
      case SwimState.Burst:
        desiredTailEffort = 1;
        break;
      case SwimState.Pivot:
        desiredTailEffort = 1;
        break;
    }

    fish.speed += (desiredSpeed - fish.speed) * (1 - Math.exp(-speedResponse * dt));
    fish.tailEffort += (desiredTailEffort - fish.tailEffort) * (1 - Math.exp(-4.5 * dt));
    fish.velocity = mul(fromAngle(fish.heading), fish.speed);
    fish.position = add(fish.position, mul(fish.velocity, dt));

    const beatRate = 0.45 + (fish.speed / fish.maximumSpeed) * 4.6 + fish.tailEffort * 0.9;
    fish.swimPhase += beatRate * dt;

    fish.spine[0] = { ...fish.position };
    const spacing = fish.bodyLength / (SPINE_NODES - 1);
    const MAX_TOTAL_BODY_CURVATURE = 0.92; // ~52.7 degrees maximum cumulative bend head-to-tail
    let cumulativeBend = 0;

    for (let node = 1; node < SPINE_NODES; node += 1) {
      const fallback = mul(fromAngle(fish.heading), -1);
      const prevDir =
        node === 1
          ? fallback
          : normalize(sub(fish.spine[node - 1], fish.spine[node - 2]), fallback);
      const prevAngle = Math.atan2(prevDir.y, prevDir.x);

      const rawDir = normalize(sub(fish.spine[node], fish.spine[node - 1]), fallback);
      const rawAngle = Math.atan2(rawDir.y, rawDir.x);
      const angleDiff = wrapAngle(rawAngle - prevAngle);

      // Cephalocaudal stiffness gradient: head and thorax (cranium/organs) are rigid, tail is flexible
      const t = node / (SPINE_NODES - 1);
      const nodeBendLimit = 0.045 + 0.115 * Math.pow(t, 1.85);

      // Enforce total cumulative body curvature clamp to prevent unnatural U-shape bending
      const remainingAllowance = Math.max(0, MAX_TOTAL_BODY_CURVATURE - Math.abs(cumulativeBend));
      const maxBendThisNode = Math.min(nodeBendLimit, remainingAllowance);
      const clampedDiff = clamp(angleDiff, -maxBendThisNode, maxBendThisNode);
      cumulativeBend += clampedDiff;

      const constrainedDir = fromAngle(prevAngle + clampedDiff);
      const constrained = add(fish.spine[node - 1], mul(constrainedDir, spacing));

      // Anatomical stiffness preservation
      const stiffness = 0.95 - t * 0.15;
      const smoothed = lerp(fish.spine[node], constrained, stiffness);
      // Strictly preserve segment spacing to prevent spine stretching or compression
      const finalDir = normalize(sub(smoothed, fish.spine[node - 1]), constrainedDir);
      fish.spine[node] = add(fish.spine[node - 1], mul(finalDir, spacing));
    }
  }

  /**
   * Depth-conditioned soft collision relaxation.
   * Prevents fish from clipping/glitching into each other or the frozen ice cube
   * when occupying the same vertical water slice, while allowing vertical slip-past.
   */
  private resolveFishCollisions(active: number[], dt: number): void {
    const count = active.length;
    for (let i = 0; i < count; i += 1) {
      const idxA = active[i];
      const fishA = this.fish[idxA];
      const isFrozenA = fishA.mutation === FishMutation.Frozen;

      for (let j = i + 1; j < count; j += 1) {
        const idxB = active[j];
        const fishB = this.fish[idxB];
        const isFrozenB = fishB.mutation === FishMutation.Frozen;

        const deltaDepth = Math.abs(fishA.depth - fishB.depth);

        if (isFrozenA && isFrozenB) {
          // Case 1: Ice cube vs Ice cube collision
          const centerA = lerp(fishA.position, fishA.spine[SPINE_NODES - 1], 0.5);
          const centerB = lerp(fishB.position, fishB.spine[SPINE_NODES - 1], 0.5);
          const dx = centerA.x - centerB.x;
          const dy = centerA.y - centerB.y;
          const dist = Math.hypot(dx, dy);
          const minIceDist = (fishA.bodyLength + fishB.bodyLength) * 0.65;
          if (dist < minIceDist && dist > 0.001) {
            const overlap = minIceDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            fishA.velocity.x += nx * overlap * 1.5;
            fishA.velocity.y += ny * overlap * 1.5;
            fishB.velocity.x -= nx * overlap * 1.5;
            fishB.velocity.y -= ny * overlap * 1.5;
          }
          continue;
        }

        if (isFrozenA || isFrozenB) {
          // Case 2: Living fish vs Frozen ice cube
          const frozen = isFrozenA ? fishA : fishB;
          const living = isFrozenA ? fishB : fishA;

          if (deltaDepth > 0.28) continue;
          const depthWeight = Math.pow(1 - deltaDepth / 0.28, 2);

          const iceCenter = lerp(frozen.position, frozen.spine[SPINE_NODES - 1], 0.5);
          const iceRadius = frozen.bodyLength * 0.65 + frozen.bodyWidth * 0.4;

          // Check living fish head, mid-body, and rear body against ice volume
          const testNodes = [0, 4, 7];
          let maxPenetration = 0;
          let pushNx = 0;
          let pushNy = 0;

          for (const nodeIdx of testNodes) {
            const pt = living.spine[nodeIdx];
            const dx = pt.x - iceCenter.x;
            const dy = pt.y - iceCenter.y;
            const dist = Math.hypot(dx, dy);
            const clearance = iceRadius + (nodeIdx === 0 ? 10 : 8);
            if (dist < clearance && dist > 0.001) {
              const penetration = clearance - dist;
              if (penetration > maxPenetration) {
                maxPenetration = penetration;
                pushNx = dx / dist;
                pushNy = dy / dist;
              }
            }
          }

          if (maxPenetration > 0) {
            const push = maxPenetration * 0.75 * depthWeight;
            const shiftX = pushNx * push;
            const shiftY = pushNy * push;

            // Rigidly translate the ENTIRE living fish so spine never kinks or tears
            living.position.x += shiftX;
            living.position.y += shiftY;
            for (let n = 0; n < SPINE_NODES; n += 1) {
              living.spine[n].x += shiftX;
              living.spine[n].y += shiftY;
            }

            // Small tactile impulse to the floating ice block
            frozen.velocity.x -= pushNx * push * 0.6 * dt;
            frozen.velocity.y -= pushNy * push * 0.6 * dt;
          }
          continue;
        }

        // Case 3: Living fish vs Living fish
        if (deltaDepth > 0.22) continue;
        const depthWeight = Math.pow(1 - deltaDepth / 0.22, 2);

        // Check head-to-head and head-to-midbody to prevent ghost clipping
        const pairs: Array<[number, number, number]> = [
          [0, 0, 18], // Head A to Head B
          [0, 4, 16], // Head A to Mid B
          [4, 0, 16], // Mid A to Head B
          [4, 4, 18], // Mid A to Mid B
        ];

        let maxOverlap = 0;
        let colNx = 0;
        let colNy = 0;

        for (const [nA, nB, reqDist] of pairs) {
          const dx = fishA.spine[nA].x - fishB.spine[nB].x;
          const dy = fishA.spine[nA].y - fishB.spine[nB].y;
          const dist = Math.hypot(dx, dy);
          if (dist < reqDist && dist > 0.001) {
            const overlap = reqDist - dist;
            if (overlap > maxOverlap) {
              maxOverlap = overlap;
              colNx = dx / dist;
              colNy = dy / dist;
            }
          }
        }

        if (maxOverlap > 0) {
          const push = maxOverlap * 0.45 * depthWeight;
          const shiftX = colNx * push * 0.5;
          const shiftY = colNy * push * 0.5;

          // Symmetrical rigid translation for both living fish
          fishA.position.x += shiftX;
          fishA.position.y += shiftY;
          for (let n = 0; n < SPINE_NODES; n += 1) {
            fishA.spine[n].x += shiftX;
            fishA.spine[n].y += shiftY;
          }

          fishB.position.x -= shiftX;
          fishB.position.y -= shiftY;
          for (let n = 0; n < SPINE_NODES; n += 1) {
            fishB.spine[n].x -= shiftX;
            fishB.spine[n].y -= shiftY;
          }

          // Vertical depth divergence assist: slip past each other in height
          if (deltaDepth < 0.12) {
            if (fishA.depth < fishB.depth) {
              fishA.targetDepth = Math.max(0.04, fishA.targetDepth - 0.04);
              fishB.targetDepth = Math.min(0.96, fishB.targetDepth + 0.04);
            } else {
              fishA.targetDepth = Math.min(0.96, fishA.targetDepth + 0.04);
              fishB.targetDepth = Math.max(0.04, fishB.targetDepth - 0.04);
            }
          }
        }
      }
    }
  }
}

