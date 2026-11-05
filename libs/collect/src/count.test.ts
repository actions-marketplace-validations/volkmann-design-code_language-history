import { describe, expect, test } from "bun:test";
import { countNonBlankLines } from "./count";

const count = (text: string) => countNonBlankLines(new TextEncoder().encode(text));

describe("countNonBlankLines", () => {
  test("counts lines with content, skips blank and whitespace-only lines", () => {
    expect(count("a\n\nb\n   \n\t\nc\n")).toBe(3);
  });

  test("counts a last line without trailing newline", () => {
    expect(count("a\nb")).toBe(2);
    expect(count("a\n  ")).toBe(1);
  });

  test("treats CR, vertical tab and form feed as whitespace", () => {
    expect(count("a\r\n\r\n\v\f\r\nb\r\n")).toBe(2);
  });

  test("empty content has no lines", () => {
    expect(count("")).toBe(0);
    expect(count("\n\n")).toBe(0);
  });

  test("non-ASCII text counts as content", () => {
    expect(count("ä\n€\n")).toBe(2);
  });

  test("a NUL byte in the first 8000 bytes means binary", () => {
    expect(countNonBlankLines(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]))).toBeNull();
    expect(count(`${"a".repeat(7999)}\0`)).toBeNull();
  });

  test("a NUL byte after the first 8000 bytes does not", () => {
    expect(count(`${"a".repeat(8000)}\0\nb\n`)).toBe(2);
  });
});
