#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { MAX_BANDS, type Theme } from "@language-history/chart";
import { collect, DEFAULT_ALIASES } from "@language-history/collect";
import type { Meta } from "@language-history/format";
import { render } from "./render";

const HELP = `language-history: lines of code per file extension over time

Usage:
  language-history collect [options]   Measure each day's last commit, write JSONL (incremental)
  language-history render  [options]   Turn the JSONL into a stacked column chart (SVG and/or PNG)

Common:
  -c, --config <file>      JSON file with any of the options below (CLI flags win)
      --data <file>        JSONL data file (default: language-history.jsonl)

collect:
      --repo <path>        Repository (default: .)
      --ref <ref>          Branch/ref whose first-parent history is measured (default: HEAD)
      --tz <zone>          IANA time zone that defines a day (default: this machine's, ${Intl.DateTimeFormat().resolvedOptions().timeZone})
      --path <pathspec>    Only count these paths, git pathspec syntax (repeatable)
      --no-linguist        Also count files marked linguist-generated / linguist-vendored
                           (default: skipped, the checkout's .gitattributes apply to all days)
      --exclude <glob>     Skip files matching this glob, e.g. '**/generated/**' (repeatable)
      --exclude-ext <ext>  Skip these extensions, comma-separated or repeated (e.g. svg,json)
      --alias <from=to>    Count one extension as another, e.g. tsx=ts; yaml=yaml undoes a default (repeatable)
      --no-default-aliases Drop the built-in aliases (${Object.entries(DEFAULT_ALIASES)
        .map(([a, b]) => `${a}→${b}`)
        .join(", ")})
      --until <date>       Fill days up to YYYY-MM-DD or "today" (default: day of the newest commit)
      --full               Ignore existing data and collect everything again

render:
  -o, --out <file>         Output .svg or .png (repeatable; default: language-history.svg)
      --threshold <share>  Own band once an extension's peak reaches this share of the peak total (default: 0.03)
      --max-bands <n>      Most named bands before the rest folds into Others (default/max: ${MAX_BANDS})
      --others-listed <n>  Extensions inside Others named in the legend, after their count (default: 3)
      --width <px> --height <px>   (default: 1200 × 460)
      --theme <t>          auto (follows the viewer's light/dark setting) | light | dark (default: auto; PNG: light)
      --title <text>       (default: "Lines of code")
      --from <date> --to <date>    Limit the rendered range
      --no-tooltips        Omit the per-day hover tooltips (smaller SVG)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    help: { type: "boolean", short: "h" },
    config: { type: "string", short: "c" },
    data: { type: "string" },
    repo: { type: "string" },
    ref: { type: "string" },
    tz: { type: "string" },
    path: { type: "string", multiple: true },
    linguist: { type: "boolean" },
    exclude: { type: "string", multiple: true },
    "exclude-ext": { type: "string", multiple: true },
    alias: { type: "string", multiple: true },
    "default-aliases": { type: "boolean" },
    until: { type: "string" },
    full: { type: "boolean" },
    out: { type: "string", short: "o", multiple: true },
    threshold: { type: "string" },
    "max-bands": { type: "string" },
    "others-listed": { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    theme: { type: "string" },
    title: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    tooltips: { type: "boolean" },
  },
});

const command = positionals[0];
if (values.help || !command) {
  console.log(HELP);
  process.exit(command || values.help ? 0 : 1);
}

interface Config {
  data?: string;
  repo?: string;
  ref?: string;
  tz?: string;
  paths?: string[];
  linguist?: boolean;
  exclude?: string[];
  excludeExt?: string[];
  aliases?: Record<string, string>;
  defaultAliases?: boolean;
  out?: string[];
  threshold?: number;
  maxBands?: number;
  othersListed?: number;
  width?: number;
  height?: number;
  theme?: Theme;
  title?: string;
  tooltips?: boolean;
}

const config: Config = values.config ? await Bun.file(values.config).json() : {};
const log = (message: string) => console.error(message);
const list = (items: string[] | undefined) =>
  items
    ?.flatMap((item) => item.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
const num = (value: string | undefined, fallback: number) =>
  value === undefined ? fallback : Number(value);
const today = () => new Intl.DateTimeFormat("en-CA").format(new Date());
const data = values.data ?? config.data ?? "language-history.jsonl";

if (command === "collect") {
  const aliases: Record<string, string> = {
    ...((values["default-aliases"] ?? config.defaultAliases ?? true) ? DEFAULT_ALIASES : {}),
    ...config.aliases,
    ...Object.fromEntries(
      (values.alias ?? []).map((a) => a.split("=").map((s) => s.trim().replace(/^\./, ""))),
    ),
  };
  for (const [from, to] of Object.entries(aliases)) {
    if (from === to) {
      delete aliases[from];
    }
  }

  const meta: Omit<Meta, "attributes"> = {
    tool: "language-history",
    version: 1,
    ref: values.ref ?? config.ref ?? "HEAD",
    tz: values.tz ?? config.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    paths: values.path ?? config.paths ?? [],
    exclude: values.exclude ?? config.exclude ?? [],
    excludeExt: list(values["exclude-ext"]) ?? config.excludeExt ?? [],
    aliases: Object.fromEntries(Object.entries(aliases).sort()),
    linguist: values.linguist ?? config.linguist ?? true,
  };
  await collect({
    repo: values.repo ?? config.repo ?? ".",
    out: data,
    meta,
    until: values.until === "today" ? today() : values.until,
    full: values.full ?? false,
    log,
  });
} else if (command === "render") {
  const theme = (values.theme ?? config.theme ?? "auto") as Theme;
  if (!["auto", "light", "dark"].includes(theme)) {
    throw new Error(`Unknown theme ${theme}`);
  }
  await render({
    input: data,
    outputs: values.out ?? config.out ?? ["language-history.svg"],
    threshold: num(values.threshold, config.threshold ?? 0.03),
    maxBands: Math.min(MAX_BANDS, num(values["max-bands"], config.maxBands ?? MAX_BANDS)),
    othersListed: num(values["others-listed"], config.othersListed ?? 3),
    width: num(values.width, config.width ?? 1200),
    height: num(values.height, config.height ?? 460),
    theme,
    title: values.title ?? config.title ?? "Lines of code",
    tooltips: values.tooltips ?? config.tooltips ?? true,
    from: values.from,
    to: values.to,
    log,
  });
} else {
  console.error(`Unknown command "${command}"\n\n${HELP}`);
  process.exit(1);
}
