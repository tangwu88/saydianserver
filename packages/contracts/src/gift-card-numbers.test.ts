import { describe, expect, it } from "vitest";
import { parseGiftCardNumbers } from "./gift-card-numbers";

describe("gift management number input", () => {
  it("accepts pasted rows and Chinese separators, normalizes and deduplicates", () => {
    expect(parseGiftCardNumbers(" 001，2\n3、4;5；6 1,2\t7 ")).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(parseGiftCardNumbers([1, "001", "2", 2147483647])).toEqual([
      1, 2, 2147483647,
    ]);
  });
  it.each([
    "",
    " ,，\n",
    "0",
    "-1",
    "1.1",
    "1e2",
    "1-10",
    "GN123",
    "2147483648",
    "1;DROP TABLE",
    null,
    {},
    [true],
    [null],
    [1.1],
    "1".repeat(10001),
  ])("rejects invalid or unbounded input %#", (input) => {
    expect(() => parseGiftCardNumbers(input)).toThrow();
  });
  it("caps distinct numbers at 100 and bounds raw input even when duplicated", () => {
    expect(
      parseGiftCardNumbers(Array.from({ length: 100 }, (_, i) => i + 1)),
    ).toHaveLength(100);
    expect(() =>
      parseGiftCardNumbers(Array.from({ length: 101 }, (_, i) => i + 1)),
    ).toThrow("最多处理100");
    expect(() => parseGiftCardNumbers(Array(1001).fill(1))).toThrow();
  });
});
