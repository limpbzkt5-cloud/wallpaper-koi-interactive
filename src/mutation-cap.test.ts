import { describe, expect, it } from "vitest";
import { School } from "./school";
import { FishMutation } from "./mutations";

describe("Mutation Max Cap Invariant", () => {
  it("enforces maxPerMutation <= 2 across all mutations on reseed", () => {
    const school = new School();
    school.mutationChance = 1.0; // 100% mutation rate

    for (let trial = 0; trial < 30; trial += 1) {
      school.reseedMutations("sunny");
      for (const m of Object.values(FishMutation)) {
        if (m === FishMutation.None) continue;
        const count = school.countMutation(m);
        expect(count).toBeLessThanOrEqual(school.maxPerMutation);
      }
    }
  });

  it("never exceeds maxPerMutation <= 2 when transformRandomFish is called repeatedly", () => {
    const school = new School();
    for (let i = 0; i < 10; i += 1) {
      school.transformRandomFish(FishMutation.Frozen);
      expect(school.countMutation(FishMutation.Frozen)).toBeLessThanOrEqual(school.maxPerMutation);
    }
  });

  it("enforces maxPerMutation <= 2 when visitors spawn", () => {
    const school = new School();
    school.transformRandomFish(FishMutation.Frozen);
    school.transformRandomFish(FishMutation.Frozen);
    expect(school.countMutation(FishMutation.Frozen)).toBe(2);

    // Attempt to spawn visitor with Frozen
    school.spawnVisitor("sunny", FishMutation.Frozen);
    expect(school.countMutation(FishMutation.Frozen)).toBeLessThanOrEqual(school.maxPerMutation);
  });

  it("clamps down excess mutations via enforceMutationCaps", () => {
    const school = new School();
    for (let i = 0; i < school.count; i += 1) {
      school.fish[i].applyMutation(FishMutation.None);
    }
    // Artificially assign 5 fish to Frozen
    for (let i = 0; i < 5; i += 1) {
      school.fish[i].applyMutation(FishMutation.Frozen);
    }
    expect(school.countMutation(FishMutation.Frozen)).toBe(5);

    school.enforceMutationCaps();
    expect(school.countMutation(FishMutation.Frozen)).toBe(school.maxPerMutation);
  });

  it("successfully transforms fish to Abyssal mutation and verifies definition", () => {
    const school = new School();
    for (let i = 0; i < school.count; i += 1) {
      school.fish[i].applyMutation(FishMutation.None);
    }
    school.transformRandomFish(FishMutation.Abyssal);
    expect(school.countMutation(FishMutation.Abyssal)).toBe(1);

    const abyssalFish = school.fish.find((f) => f.mutation === FishMutation.Abyssal);
    expect(abyssalFish).toBeDefined();
    expect(abyssalFish?.mutation).toBe(FishMutation.Abyssal);
  });

  it("never suffers from runaway fish growth upon repeated mutations", () => {
    const school = new School();
    const fish = school.fish[0];
    const initialLength = fish.baseBodyLength;
    const initialWidth = fish.baseBodyWidth;

    // Apply mutations 50 times in a row
    for (let i = 0; i < 50; i++) {
      fish.applyMutation(FishMutation.Frozen);
      fish.applyMutation(FishMutation.Abyssal);
      fish.applyMutation(FishMutation.Crimson);
      fish.applyMutation(FishMutation.None);
    }

    // When back to None, size MUST exactly equal base size
    expect(fish.bodyLength).toBeCloseTo(initialLength, 4);
    expect(fish.bodyWidth).toBeCloseTo(initialWidth, 4);

    // When applied a specific mutation, size must be base * scale, NOT exponentially compounded
    fish.applyMutation(FishMutation.Frozen);
    expect(fish.bodyLength).toBeLessThan(initialLength * 1.5);
    expect(fish.bodyWidth).toBeLessThan(initialWidth * 1.5);
  });
});

describe("Weather Mode Selection & Cycling", () => {
  it("maps device hours to appropriate diurnal weather presets", async () => {
    const { getWeatherForDeviceTime, WEATHER_CYCLE_SEQUENCE } = await import("./weather");

    // 06:00 -> mist
    const dMorning = new Date(2026, 0, 1, 6, 0, 0);
    expect(getWeatherForDeviceTime(dMorning)).toBe("mist");

    // 10:00 -> sunny
    const dDay = new Date(2026, 0, 1, 10, 0, 0);
    expect(getWeatherForDeviceTime(dDay)).toBe("sunny");

    // 14:00 -> deep-clear
    const dAfternoon = new Date(2026, 0, 1, 14, 0, 0);
    expect(getWeatherForDeviceTime(dAfternoon)).toBe("deep-clear");

    // 18:00 -> sunset
    const dSunset = new Date(2026, 0, 1, 18, 0, 0);
    expect(getWeatherForDeviceTime(dSunset)).toBe("sunset");

    // 23:00 & 02:00 -> moonlight
    const dNight1 = new Date(2026, 0, 1, 23, 0, 0);
    const dNight2 = new Date(2026, 0, 1, 2, 0, 0);
    expect(getWeatherForDeviceTime(dNight1)).toBe("moonlight");
    expect(getWeatherForDeviceTime(dNight2)).toBe("moonlight");

    expect(WEATHER_CYCLE_SEQUENCE.length).toBe(7);
    expect(WEATHER_CYCLE_SEQUENCE).toContain("sunny");
    expect(WEATHER_CYCLE_SEQUENCE).toContain("moonlight");
  });
});
