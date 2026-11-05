import { describe, expect, test } from "bun:test";
import { type Dataset, type Meta, parseDataset, sameSettings, serializeDataset } from "./dataset";

const meta: Meta = {
  tool: "language-history",
  version: 1,
  ref: "main",
  tz: "UTC",
  paths: [],
  exclude: [],
  excludeExt: [],
  aliases: { yaml: "yml" },
  linguist: true,
  own: [],
  attributes: "",
};

const dataset: Dataset = {
  meta,
  days: [
    { date: "2026-01-01", commit: "a", carried: false, total: 3, byExt: { ts: 2, md: 1 } },
    { date: "2026-01-02", commit: "a", carried: true, total: 3, byExt: { ts: 2, md: 1 } },
  ],
};

describe("dataset", () => {
  test("one JSON line for the settings, then one per day", () => {
    const lines = serializeDataset(dataset).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ meta });
    expect(JSON.parse(lines[2]).date).toBe("2026-01-02");
  });

  test("round-trips", () => {
    expect(parseDataset(serializeDataset(dataset))).toEqual(dataset);
  });

  test("blank lines are ignored and the settings line is optional", () => {
    const text = `\n${JSON.stringify(dataset.days[0])}\n\n`;
    expect(parseDataset(text)).toEqual({ meta: null, days: [dataset.days[0]] });
  });

  test("settings compare by value", () => {
    expect(sameSettings(meta, { ...meta })).toBe(true);
    expect(sameSettings(meta, { ...meta, tz: "Europe/Berlin" })).toBe(false);
  });
});
