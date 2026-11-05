import { describe, expect, test } from "bun:test";
import type { DayRecord } from "@language-history/format";
import { computeBands, OTHERS } from "./bands";

let n = 0;
const day = (counts: Record<string, number>): DayRecord => ({
  date: `2026-01-${String(++n).padStart(2, "0")}`,
  commit: `c${n}`,
  carried: false,
  total: Object.values(counts).reduce((sum, v) => sum + v, 0),
  counts,
});

describe("computeBands", () => {
  test("threshold is measured against the peak total, not per day", () => {
    // lock is 90 % of day 1 but only 1 % of the peak total
    const days = [day({ lock: 9, ts: 1 }), day({ lock: 10, ts: 900, md: 90 })];
    const bands = computeBands(days, { threshold: 0.03, maxBands: 8 });
    expect(bands.keys).toEqual(["ts", "md", OTHERS]);
    expect(bands.values).toEqual([
      [1, 0, 9],
      [900, 90, 10],
    ]);
  });

  test("an extension that peaked above the threshold keeps its band after shrinking", () => {
    const days = [day({ ts: 100, sql: 100 }), day({ ts: 1000, sql: 1 })];
    expect(computeBands(days, { threshold: 0.03, maxBands: 8 }).keys).toEqual(["ts", "sql"]);
  });

  test("orders by size on the last day, ties by peak", () => {
    const days = [day({ a: 10, b: 50, c: 40 }), day({ a: 30, d: 20 })];
    const { keys } = computeBands(days, { threshold: 0, maxBands: 8 });
    // b and c are gone on the last day: b (peak 50) before c (peak 40)
    expect(keys).toEqual(["a", "d", "b", "c"]);
  });

  test("folds everything beyond maxBands into Others", () => {
    const days = [day({ a: 40, b: 30, c: 20, d: 10 })];
    const bands = computeBands(days, { threshold: 0, maxBands: 2 });
    expect(bands.keys).toEqual(["a", "b", OTHERS]);
    expect(bands.values).toEqual([[40, 30, 30]]);
  });

  test("lists the extensions inside Others on the last day, largest first", () => {
    const days = [day({ a: 100, old: 2 }), day({ a: 100, c: 1, b: 2, d: 1 })];
    expect(computeBands(days, { threshold: 0.5, maxBands: 8 }).others).toEqual(["b", "c", "d"]);
  });

  test("omits Others when nothing folds into it", () => {
    const days = [day({ a: 40, b: 30 }), day({ a: 50, b: 30 })];
    const bands = computeBands(days, { threshold: 0.03, maxBands: 8 });
    expect(bands.keys).toEqual(["a", "b"]);
    expect(bands.values).toEqual([
      [40, 30],
      [50, 30],
    ]);
  });

  test("each row sums to the day total", () => {
    const days = [day({ a: 5, b: 1, c: 300 }), day({ a: 500, d: 2 }), day({ e: 7, a: 600 })];
    const bands = computeBands(days, { threshold: 0.05, maxBands: 8 });
    bands.values.forEach((row, i) => {
      expect(row.reduce((sum, v) => sum + v, 0)).toBe(days[i].total);
    });
  });
});
