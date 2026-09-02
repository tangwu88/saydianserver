import { describe, expect, it } from "vitest";
import { assertIdentifier } from "./config";

describe("migration identifiers", () => {
  it("blocks SQL fragments from mapping files", () => {
    expect(() => assertIdentifier("member")).not.toThrow();
    expect(() => assertIdentifier("member; DROP TABLE user")).toThrow();
  });
});
