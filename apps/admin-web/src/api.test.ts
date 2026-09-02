import { describe, expect, it } from "vitest";
import { responseData } from "./api";

describe("admin API envelope", () => {
  it("reads only the standardized data field", () => {
    expect(
      responseData<{ members: number }>({
        data: {
          code: 200,
          message: "OK",
          data: { members: 12 },
          timestamp: 1,
          requestId: "request-1",
        },
      }),
    ).toEqual({ members: 12 });
  });
});
