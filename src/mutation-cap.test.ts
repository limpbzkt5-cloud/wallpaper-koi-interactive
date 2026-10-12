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
});
