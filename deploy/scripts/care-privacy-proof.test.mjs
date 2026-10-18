import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { assertPrivacyDataModel } = createRequire(import.meta.url)(
  "./care-privacy-proof.cjs",
);
const model = () => ({
  dmmf: {
    datamodel: {
      models: [
        {
          name: "CareRelationship",
          fields: [
            {
              name: "identityDisclosure",
              type: "CareIdentityDisclosure",
              isRequired: true,
            },
          ],
        },
      ],
      enums: [
        {
          name: "CareIdentityDisclosure",
          values: ["CONTACT", "MEMBER_NO_PENDING", "MEMBER_NO_ACCEPTED"].map(
            (name) => ({ name }),
          ),
        },
      ],
    },
  },
});
test("runtime proof checks the actual generated client, never a declared compatibility version", () => {
  assertPrivacyDataModel(model());
  for (const change of [
    (m) => (m.dmmf.datamodel.models[0].fields = []),
    (m) => (m.dmmf.datamodel.models[0].fields[0].isRequired = false),
    (m) => m.dmmf.datamodel.enums[0].values.pop(),
  ]) {
    const m = model();
    change(m);
    m.CARE_PRIVACY_COMPATIBLE = true;
    m.version = "9999";
    assert.throws(() => assertPrivacyDataModel(m));
  }
});
