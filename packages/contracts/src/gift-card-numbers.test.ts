import { describe, expect, it } from "vitest";
import { parseGiftCardNumbers, parseGiftCardNos } from "./gift-card-numbers";

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

describe("eight-digit gift card numbers", () => {
  it("accepts real-format card numbers, preserves them as strings and deduplicates pasted input", () => {
    expect(
      parseGiftCardNos(
        "80100611，80100612\n80100611 80100613；80100614、80100615",
      ),
    ).toEqual(["80100611", "80100612", "80100613", "80100614", "80100615"]);
    expect(parseGiftCardNos(["80100611", " 80100612 ", "80100611"])).toEqual([
      "80100611",
      "80100612",
    ]);
  });
  it.each([
    "",
    "1",
    "611",
    "080100611",
    "8010061",
    "801006110",
    "70100611",
    "80100611-80100612",
    "8.0100611e7",
    "80100611,1",
    null,
    [80100611],
    [true],
    "8".repeat(10001),
  ])(
    "rejects management IDs, invalid card numbers and unbounded input %#",
    (input) => {
      expect(() => parseGiftCardNos(input)).toThrow();
    },
  );
  it("allows 100 unique cards and refuses larger batches", () => {
    const cards = Array.from({ length: 100 }, (_, i) => String(80100611 + i));
    expect(parseGiftCardNos(cards.concat(cards))).toHaveLength(100);
    expect(() => parseGiftCardNos(cards.concat("89999999"))).toThrow(
      "100个不同卡号",
    );
    expect(() => parseGiftCardNos(Array(1001).fill("80100611"))).toThrow();
  });
});
