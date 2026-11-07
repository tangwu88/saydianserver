import adultMale from "./assets/health-body.png";
import adultFemale from "./assets/profiles/adult-female.webp";
import childMale from "./assets/profiles/child-male.webp";
import childFemale from "./assets/profiles/child-female.webp";
import teenMale from "./assets/profiles/teen-male.webp";
import teenFemale from "./assets/profiles/teen-female.webp";
import seniorMale from "./assets/profiles/senior-male.webp";
import seniorFemale from "./assets/profiles/senior-female.webp";
import type {
  HealthScreenGroup,
  HealthScreenResponse,
} from "@saydian/app-contracts";
const figures = {
  child: {
    label: "儿童",
    male: childMale,
    female: childFemale,
    anchors: [16, 40, 57, 39, 50, 78],
  },
  teen: {
    label: "青少年",
    male: teenMale,
    female: teenFemale,
    anchors: [8, 29, 48, 27, 42, 72],
  },
  adult: {
    label: "成人",
    male: adultMale,
    female: adultFemale,
    anchors: [9, 28, 48, 26, 45, 74],
  },
  senior: {
    label: "老年",
    male: seniorMale,
    female: seniorFemale,
    anchors: [8, 29, 49, 27, 42, 73],
  },
};
export function selectBodyProfile(
  person: Pick<
    HealthScreenResponse["member"],
    "gender" | "age" | "weightKg" | "heightCm"
  >,
) {
  if (
    person.age === null ||
    person.age < 0 ||
    person.age > 130 ||
    !["MALE", "FEMALE"].includes(person.gender)
  )
    return null;
  const age =
    person.age < 12
      ? "child"
      : person.age < 18
        ? "teen"
        : person.age < 60
          ? "adult"
          : "senior";
  const fig = figures[age],
    female = person.gender === "FEMALE";
  // Height is optional. Only adults with both measurements receive a gentle illustrative width adjustment.
  const width =
    (age === "adult" || age === "senior") &&
    person.heightCm &&
    person.heightCm >= 50 &&
    person.weightKg > 0
      ? Math.max(
          0.92,
          Math.min(
            1.12,
            0.99 +
              (person.weightKg / (person.heightCm / 100) ** 2 - 22) * 0.008,
          ),
        )
      : 1;
  const [sleep, heart, temp, oxygen, metabolic, activity] = fig.anchors;
  const anchors: Record<HealthScreenGroup, [number, number]> = {
    sleep: [50, sleep!],
    cardiovascular: [52, heart!],
    temperature: [31, temp!],
    oxygen: [45, oxygen!],
    metabolic: [50, metabolic!],
    activity: [54, activity!],
  };
  return {
    key: age + "-" + (female ? "female" : "male"),
    src: female ? fig.female : fig.male,
    label: fig.label + " · " + (female ? "女" : "男"),
    width,
    anchors,
    child: age === "child",
  };
}
