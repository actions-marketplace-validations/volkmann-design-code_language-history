import { isAbsolute, relative, resolve } from "node:path";
import { MAX_BANDS, type Theme } from "@language-history/chart";
import type { RenderOptions } from "@language-history/chart/files";
import { type CollectOptions, DEFAULT_ALIASES } from "@language-history/collect";

/**
 * Everything a run can be configured with: the keys of a JSON config file, and what CLI flags and
 * action inputs map to. Unset keys fall back to the defaults below.
 */
export interface Settings {
  /** JSONL data file. Default: language-history.jsonl */
  data?: string;
  // collect
  repo?: string;
  ref?: string;
  tz?: string;
  paths?: string[];
  linguist?: boolean;
  exclude?: string[];
  excludeExt?: string[];
  /** Added to the default aliases; `{ "yaml": "yaml" }` undoes one. */
  aliases?: Record<string, string>;
  defaultAliases?: boolean;
  /** Last day to fill, YYYY-MM-DD or "today". */
  until?: string;
  full?: boolean;
  // render
  out?: string[];
  threshold?: number;
  maxBands?: number;
  othersListed?: number;
  width?: number;
  height?: number;
  theme?: Theme;
  title?: string;
  tooltips?: boolean;
  from?: string;
  to?: string;
}

const KEYS: Record<keyof Settings, "string" | "number" | "boolean" | "list" | "record"> = {
  data: "string",
  repo: "string",
  ref: "string",
  tz: "string",
  paths: "list",
  linguist: "boolean",
  exclude: "list",
  excludeExt: "list",
  aliases: "record",
  defaultAliases: "boolean",
  until: "string",
  full: "boolean",
  out: "list",
  threshold: "number",
  maxBands: "number",
  othersListed: "number",
  width: "number",
  height: "number",
  theme: "string",
  title: "string",
  tooltips: "boolean",
  from: "string",
  to: "string",
};

export const DEFAULT_DATA = "language-history.jsonl";
export const DEFAULT_OUT = ["language-history.svg"];

/** Checks shape and values; `source` names the origin in error messages. */
export function validateSettings(value: unknown, source: string): Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source}: expected a JSON object`);
  }
  for (const [key, v] of Object.entries(value)) {
    const kind = KEYS[key as keyof Settings];
    if (!kind) {
      throw new Error(`${source}: unknown setting "${key}"`);
    }
    const ok =
      v === undefined ||
      (kind === "list"
        ? Array.isArray(v) && v.every((item) => typeof item === "string")
        : kind === "record"
          ? typeof v === "object" &&
            v !== null &&
            !Array.isArray(v) &&
            Object.values(v).every((item) => typeof item === "string")
          : typeof v === kind && (kind !== "number" || Number.isFinite(v)));
    if (!ok) {
      throw new Error(
        `${source}: "${key}" must be ${kind === "list" ? "a list of strings" : kind === "record" ? "an object of strings" : `a ${kind}`}`,
      );
    }
  }
  const settings = value as Settings;
  if (settings.theme !== undefined && !["auto", "light", "dark"].includes(settings.theme)) {
    throw new Error(`${source}: "theme" must be auto, light or dark`);
  }
  return settings;
}

/** Reads a JSON config file; no path means no settings. */
export async function loadSettings(path: string | undefined): Promise<Settings> {
  if (!path) {
    return {};
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${path}`);
  }
  return validateSettings(await file.json(), path);
}

/** Later layers win; unset values don't override. `aliases` add up instead of replacing. */
export function mergeSettings(...layers: Settings[]): Settings {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) {
        continue;
      }
      merged[key] =
        key === "aliases" ? { ...(merged.aliases as Record<string, string>), ...value } : value;
    }
  }
  return merged as Settings;
}

const today = () => new Intl.DateTimeFormat("en-CA").format(new Date());

/**
 * The data file and chart outputs relative to the repository root (`repo` has to be the root),
 * leaving out those outside the repository. Paths are relative to `cwd`.
 */
export function ownFiles(settings: Settings, cwd: string): string[] {
  const root = resolve(cwd, settings.repo ?? ".");
  const files = [settings.data ?? DEFAULT_DATA, ...(settings.out ?? DEFAULT_OUT)]
    .map((path) => relative(root, resolve(cwd, path)).split("\\").join("/"))
    .filter((path) => path && !path.startsWith("../") && !isAbsolute(path));
  return [...new Set(files)].sort();
}

export function collectOptions(
  settings: Settings,
  log: (message: string) => void,
  cwd = process.cwd(),
): CollectOptions {
  const aliases: Record<string, string> = {
    ...((settings.defaultAliases ?? true) ? DEFAULT_ALIASES : {}),
    ...Object.fromEntries(
      Object.entries(settings.aliases ?? {}).map(([from, to]) => [
        from.replace(/^\./, ""),
        to.replace(/^\./, ""),
      ]),
    ),
  };
  for (const [from, to] of Object.entries(aliases)) {
    if (from === to) {
      delete aliases[from];
    }
  }
  return {
    repo: settings.repo ?? ".",
    out: settings.data ?? DEFAULT_DATA,
    meta: {
      tool: "language-history",
      version: 1,
      ref: settings.ref ?? "HEAD",
      tz: settings.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      paths: settings.paths ?? [],
      exclude: settings.exclude ?? [],
      excludeExt: settings.excludeExt ?? [],
      aliases: Object.fromEntries(Object.entries(aliases).sort()),
      linguist: settings.linguist ?? true,
      own: ownFiles(settings, cwd),
    },
    until: settings.until === "today" ? today() : settings.until,
    full: settings.full ?? false,
    log,
  };
}

export function renderOptions(settings: Settings, log: (message: string) => void): RenderOptions {
  return {
    input: settings.data ?? DEFAULT_DATA,
    outputs: settings.out ?? DEFAULT_OUT,
    threshold: settings.threshold ?? 0.03,
    maxBands: Math.min(MAX_BANDS, settings.maxBands ?? MAX_BANDS),
    othersListed: settings.othersListed ?? 3,
    width: settings.width ?? 1200,
    height: settings.height ?? 460,
    theme: settings.theme ?? "auto",
    title: settings.title ?? "Lines of code",
    tooltips: settings.tooltips ?? true,
    from: settings.from,
    to: settings.to,
    log,
  };
}
