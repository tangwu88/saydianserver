export const sayRingFirmwareFamilies = [
  { transport: "qring", packageModel: "R21", models: ["R8", "R21"] },
  { transport: "coolwear", packageModel: "HR05", models: ["R7Pro", "R7Ultra"] },
  { transport: "coolwear", packageModel: "HR01", models: ["R7", "R7Y"] },
] as const;

// This maps a product model, not an arbitrary Bluetooth advertisement.
export function sayRingFirmwareTarget(transport: string, model: string) {
  const name = model.replace(/[ _-]+/g, "").toUpperCase();
  const canonical = name === "R7U" ? "R7ULTRA" : name;
  for (const family of sayRingFirmwareFamilies) {
    if (transport !== family.transport) continue;
    const match = family.models.find(candidate => candidate.toUpperCase() === canonical);
    if (match) return { model: match, packageModel: family.packageModel };
  }
  return undefined;
}
