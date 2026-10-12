import { describe, expect, it } from "vitest";
import { School } from "./school";
import { vec } from "./math";

describe("School Post-Gather Scatter", () => {
  it("starts a 5-second countdown on callTo and disperses the cluster upon expiry", () => {
    const school = new School();
    const clickPoint = vec(200, 200);

    school.callTo(clickPoint);
    expect(school.targetActive).toBe(true);
    expect(school.clickScatterCountdown).toBe(5.0);

    // Simulate 4.0 seconds - still gathering
    for (let t = 0; t < 4.0; t += 0.1) {
      school.update(0.1, t);
    }
    expect(school.clickScatterCountdown).toBeGreaterThan(0);
    expect(school.clickScatterCountdown).toBeLessThanOrEqual(1.1);

    // Advance another 1.2 seconds (past 5.0s threshold)
    for (let t = 0; t < 1.2; t += 0.1) {
      school.update(0.1, 4.0 + t);
    }
    expect(school.clickScatterCountdown).toBe(-1);
    expect(school.targetActive).toBe(false);
    expect(school.scatterDecay).toBeGreaterThan(0);
  });

  it("starts a 5-second countdown when all food pellets are consumed and then scatters", () => {
    const school = new School();
    const foodCenter = vec(250, 180);

    // 1. Food is dropped
    school.notifyFoodStatus(5, foodCenter);
    expect(school.foodScatterCountdown).toBe(-1);

    // 2. Food is still being eaten
    school.notifyFoodStatus(2, foodCenter);
    expect(school.foodScatterCountdown).toBe(-1);

    // 3. All food has just been finished
    school.notifyFoodStatus(0, foodCenter);
    expect(school.foodScatterCountdown).toBe(5.0);

    // Advance 4.5 seconds - still in countdown
    for (let t = 0; t < 4.5; t += 0.1) {
      school.update(0.1, t);
    }
    expect(school.foodScatterCountdown).toBeGreaterThan(0);

    // Advance past 5.0 seconds
    for (let t = 0; t < 1.0; t += 0.1) {
      school.update(0.1, 4.5 + t);
    }
    expect(school.foodScatterCountdown).toBe(-1);
    expect(school.scatterDecay).toBeGreaterThan(0);
    expect(school.scatterCenter).toEqual(foodCenter);
  });
});
