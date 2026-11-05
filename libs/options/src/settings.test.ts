import { describe, expect, test } from "bun:test";
import {
  collectOptions,
  mergeSettings,
  ownFiles,
  renderOptions,
  validateSettings,
} from "./settings";

const log = () => {};

describe("validateSettings", () => {
  test("accepts known keys with the right types", () => {
    const settings = { data: "d.jsonl", out: ["a.svg"], threshold: 0.1, aliases: { tsx: "ts" } };
    expect(validateSettings(settings, "config")).toEqual(settings);
  });

  test("rejects unknown keys, wrong types and unknown themes", () => {
    expect(() => validateSettings({ outputs: ["a.svg"] }, "config")).toThrow(
      'config: unknown setting "outputs"',
    );
    expect(() => validateSettings({ out: "a.svg" }, "config")).toThrow("a list of strings");
    expect(() => validateSettings({ width: Number.NaN }, "flags")).toThrow(
      '"width" must be a number',
    );
    expect(() => validateSettings({ aliases: { tsx: 1 } }, "config")).toThrow(
      "an object of strings",
    );
    expect(() => validateSettings({ theme: "blue" }, "config")).toThrow("auto, light or dark");
    expect(() => validateSettings([], "config")).toThrow("expected a JSON object");
  });

  test("ignores unset values", () => {
    expect(validateSettings({ data: undefined }, "flags")).toEqual({ data: undefined });
  });
});

describe("mergeSettings", () => {
  test("later layers win, unset values don't override, aliases add up", () => {
    const merged = mergeSettings(
      { data: "a.jsonl", tz: "UTC", aliases: { tsx: "ts" } },
      { data: "b.jsonl", tz: undefined, aliases: { yaml: "yaml" } },
    );
    expect(merged).toEqual({ data: "b.jsonl", tz: "UTC", aliases: { tsx: "ts", yaml: "yaml" } });
  });
});

describe("collectOptions", () => {
  test("defaults", () => {
    const options = collectOptions({}, log);
    expect(options.out).toBe("language-history.jsonl");
    expect(options.repo).toBe(".");
    expect(options.meta.ref).toBe("HEAD");
    expect(options.meta.linguist).toBe(true);
    expect(options.meta.aliases.yaml).toBe("yml");
  });

  test("aliases extend the defaults, x=x undoes one, leading dots are dropped", () => {
    const { meta } = collectOptions({ aliases: { ".tsx": ".ts", yaml: "yaml" } }, log);
    expect(meta.aliases.tsx).toBe("ts");
    expect(meta.aliases.yaml).toBeUndefined();
    expect(meta.aliases.mjs).toBe("js");
    expect(Object.keys(meta.aliases)).toEqual(Object.keys(meta.aliases).sort());
  });

  test("defaultAliases: false keeps only the given ones", () => {
    const { meta } = collectOptions({ defaultAliases: false, aliases: { tsx: "ts" } }, log);
    expect(meta.aliases).toEqual({ tsx: "ts" });
  });

  test("until today becomes a date", () => {
    expect(collectOptions({ until: "today" }, log).until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("ownFiles", () => {
  test("data and outputs relative to the repository root, outside ones dropped", () => {
    expect(ownFiles({}, "/work")).toEqual(["language-history.jsonl", "language-history.svg"]);
    expect(
      ownFiles(
        { repo: "..", data: "history.jsonl", out: ["../x/chart.svg", "/elsewhere/a.png"] },
        "/work/repo",
      ),
    ).toEqual(["repo/history.jsonl", "x/chart.svg"]);
  });

  test("end up in the collect settings", () => {
    expect(collectOptions({ data: "./d.jsonl", out: ["c.svg"] }, log, "/w").meta.own).toEqual([
      "c.svg",
      "d.jsonl",
    ]);
  });
});

describe("renderOptions", () => {
  test("defaults, and maxBands is capped by the palette", () => {
    const options = renderOptions({ maxBands: 20 }, log);
    expect(options.input).toBe("language-history.jsonl");
    expect(options.outputs).toEqual(["language-history.svg"]);
    expect(options.maxBands).toBe(8);
    expect(options.theme).toBe("auto");
    expect(options.tooltips).toBe(true);
  });
});
