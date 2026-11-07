import { describe, it, expect } from "vitest";
import { selectBodyProfile } from "../../../packages/health-screen-ui/src/body-profile";
describe("individual body illustration", () => {
  it("chooses a distinct image for every sex and age band, including boundaries", () => {
    const distinct = new Set<string>();
    for (const gender of ["MALE", "FEMALE"])
      for (const [age, expected] of [
        [0, "child"],
        [11, "child"],
        [12, "teen"],
        [17, "teen"],
        [18, "adult"],
        [59, "adult"],
        [60, "senior"],
        [104, "senior"],
      ] as const) {
        const fig = selectBodyProfile({
          gender,
          age,
          heightCm: null,
          weightKg: 61,
        })!;
        expect(fig.key).toBe(expected + "-" + gender.toLowerCase());
        expect(fig.width).toBe(1);
        distinct.add(fig.src);
      }
    expect(distinct.size).toBe(8);
    expect(
      selectBodyProfile({
        gender: "UNSPECIFIED",
        age: 9,
        weightKg: 28,
        heightCm: null,
      }),
    ).toBeNull();
    expect(
      selectBodyProfile({
        gender: "FEMALE",
        age: null,
        weightKg: 28,
        heightCm: null,
      }),
    ).toBeNull();
  });
  it("honours measured adult proportions and keeps childhood visuals independent of adult BMI", () => {
    const member = { gender: "FEMALE", age: 45, heightCm: 160, weightKg: 53 };
    expect(
      selectBodyProfile({ ...member, weightKg: 90 })!.width,
    ).toBeGreaterThan(selectBodyProfile(member)!.width);
    expect(selectBodyProfile({ ...member, age: 11 })!.width).toBe(1);
  });
});
