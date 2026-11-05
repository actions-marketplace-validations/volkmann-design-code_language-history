#!/usr/bin/env bun
/**
 * Regenerates the example charts in examples/ from public repositories and measures the runs.
 *
 *   bun run examples [--cache <dir>] [--only <name>]...
 *   bun run examples --readme      (only rewrite the README section from benchmarks.json)
 *
 * Each repository is cloned (or pulled) into the cache directory, then measured with the CLI as a
 * user would run it: a full collect with examples/<name>.config.json, an incremental collect right
 * after it (what a daily update costs) and a render per chart, each with its own `by`. Results go
 * to examples/benchmarks.json and to the marked section of the README.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { dimensionNames, parseDataset, project } from "@language-history/format";

/** One chart rendered from an example's data. */
interface Chart {
  /** In examples/. */
  file: string;
  /** Shown in the README's table. */
  label: string;
  /** The dimension the bands stand for; default: ext. */
  by?: string;
  /** Default: "Lines of code in <repository>". */
  title?: string;
}

interface Example {
  name: string;
  url: string;
  title: string;
  charts: Chart[];
}

interface Run {
  seconds: number;
  /** Peak resident memory of the Bun process in MB (git subprocesses not included). */
  peakMB: number;
}

interface Benchmark {
  name: string;
  title: string;
  url: string;
  ref: string;
  commit: string;
  commits: number;
  firstParentCommits: number;
  packMB: number;
  firstDay: string;
  lastDay: string;
  days: number;
  measuredDays: number;
  lines: number;
  extensions: number;
  dataKB: number;
  full: Run;
  incremental: Run;
  render: Run;
}

interface Machine {
  cpu: string;
  memoryGB: number;
  os: string;
  bun: string;
  git: string;
  date: string;
}

const root = resolve(import.meta.dir, "../../..");
const cli = join(root, "apps/cli/src/cli.ts");
const examplesDir = join(root, "examples");
const readmePath = join(root, "README.md");
const START = "<!-- examples:start -->";
const END = "<!-- examples:end -->";

const { values } = parseArgs({
  options: {
    cache: { type: "string", default: join(tmpdir(), "language-history-examples") },
    only: { type: "string", multiple: true },
    readme: { type: "boolean", default: false },
  },
});

async function run(cmd: string[], cwd = root): Promise<{ out: string; run: Run }> {
  const started = performance.now();
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  const seconds = (performance.now() - started) / 1000;
  if (code !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${code})`);
  }
  const peakMB = Math.round((proc.resourceUsage()?.maxRSS ?? 0) / 1024 / 1024);
  return { out: out.trim(), run: { seconds: Math.round(seconds * 100) / 100, peakMB } };
}

const git = async (repo: string, ...args: string[]) =>
  (await run(["git", "-C", repo, ...args])).out;

async function checkout(example: Example): Promise<string> {
  const dir = join(values.cache, example.name);
  if (existsSync(join(dir, ".git"))) {
    console.log(`Pulling ${example.title}`);
    await git(dir, "pull", "--ff-only", "--quiet");
  } else {
    console.log(`Cloning ${example.title} into ${dir}`);
    await mkdir(values.cache, { recursive: true });
    await run(["git", "clone", "--quiet", "--single-branch", example.url, dir]);
  }
  return dir;
}

async function measure(example: Example): Promise<Benchmark> {
  const repo = await checkout(example);
  const ref = await git(repo, "rev-parse", "--abbrev-ref", "HEAD");
  // The data stays out of the repository, next to the clone.
  const data = join(values.cache, `${example.name}.jsonl`);
  const configPath = join(examplesDir, `${example.name}.config.json`);
  const config = existsSync(configPath) ? ["-c", configPath] : [];
  const collect = ["bun", cli, "collect", ...config, "--repo", repo, "--ref", ref, "--tz", "UTC"];
  collect.push("--data", data);

  console.log(`${example.title}: full collect`);
  const full = (await run([...collect, "--full"])).run;
  console.log(`${example.title}: incremental collect`);
  const incremental = (await run(collect)).run;
  // The render time is the first chart's (by extension)
  let render: Run | undefined;
  for (const chart of example.charts) {
    console.log(`${example.title}: render ${chart.file}`);
    const rendered = await run([
      "bun",
      cli,
      "render",
      ...config,
      "--data",
      data,
      "-o",
      join(examplesDir, chart.file),
      "--no-tooltips",
      "--by",
      chart.by ?? "ext",
      "--title",
      chart.title ?? `Lines of code in ${example.title}`,
    ]);
    render ??= rendered.run;
  }

  const dataset = parseDataset(await readFile(data, "utf8"));
  const last = dataset.days[dataset.days.length - 1];
  const extensions = new Set(
    dataset.days.flatMap((day) =>
      Object.keys(project(day.counts, dimensionNames(dataset.meta), ["ext"])),
    ),
  );
  const pack = await git(repo, "count-objects", "-v");
  const packKB = Number(/size-pack: (\d+)/.exec(pack)?.[1] ?? 0);
  return {
    name: example.name,
    title: example.title,
    url: example.url,
    ref,
    commit: await git(repo, "rev-parse", "HEAD"),
    commits: Number(await git(repo, "rev-list", "--count", "HEAD")),
    firstParentCommits: Number(await git(repo, "rev-list", "--first-parent", "--count", "HEAD")),
    packMB: Math.round(packKB / 1024),
    firstDay: dataset.days[0].date,
    lastDay: last.date,
    days: dataset.days.length,
    measuredDays: dataset.days.filter((day) => !day.carried).length,
    lines: last.total,
    extensions: extensions.size,
    dataKB: Math.round((await stat(data)).size / 1024),
    full,
    incremental,
    render: render ?? { seconds: 0, peakMB: 0 },
  };
}

const int = (n: number) => n.toLocaleString("en-US");
const duration = (seconds: number) =>
  seconds < 10
    ? `${seconds < 0.1 ? "< 0.1" : seconds.toFixed(1)} s`
    : seconds < 60
      ? `${Math.round(seconds)} s`
      : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;

/** `{"a":["b"]}` → `{ "a": ["b"] }`, for a caption. */
const inlineJson = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll('":', '": ')
    .replaceAll(',"', ', "')
    .replaceAll('{"', '{ "')
    .replace(/(?<=[\]"}\d])\}/g, " }");

/**
 * The settings that make a chart: the example's config, with `by` for charts of a dimension.
 * Charts per extension don't need the dimensions, so they are left out there.
 */
function chartSettings(config: Record<string, unknown>, chart: Chart): Record<string, unknown> {
  const { dimensions, ...rest } = config;
  return chart.by && chart.by !== "ext" ? { ...rest, dimensions, by: chart.by } : rest;
}

async function readConfig(example: Example): Promise<Record<string, unknown>> {
  const path = join(examplesDir, `${example.name}.config.json`);
  return existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : {};
}

async function markdown(
  examples: Example[],
  benchmarks: Benchmark[],
  machine: string,
): Promise<string> {
  const shown = examples.filter((example) => benchmarks.some((b) => b.name === example.name));
  const intro =
    "Each repository is collected once, with its config file; every chart renders that data with " +
    "its own `by`. The settings are below each chart.";
  const sections: string[] = [];
  for (const example of shown) {
    const config = await readConfig(example);
    const link = example.url.replace(/\.git$/, "");
    // One paragraph per chart: the caption sits right under its image, the paragraph gap before the
    // next chart. (GitHub drops <figure> and <figcaption>, which leaves the caption without spacing.)
    const figures = example.charts.map(
      (chart) =>
        `![${example.title}: ${chart.label.toLowerCase()}](examples/${chart.file})<br>\n` +
        `<sub><b>${chart.label}</b> · \`${inlineJson(chartSettings(config, chart))}\`</sub>`,
    );
    sections.push([`### [${example.title}](${link})`, ...figures].join("\n\n"));
  }
  const table = [
    "| Repository | Commits | First-parent | Days | Measured | Lines today | Data file | Full collect | Daily update | Render | Peak memory |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
    ...benchmarks.map((b) =>
      [
        "",
        b.title,
        int(b.commits),
        int(b.firstParentCommits),
        int(b.days),
        int(b.measuredDays),
        int(b.lines),
        b.dataKB < 1024 ? `${int(b.dataKB)} KB` : `${(b.dataKB / 1024).toFixed(1)} MB`,
        duration(b.full.seconds),
        duration(b.incremental.seconds),
        duration(b.render.seconds),
        `${int(b.full.peakMB)} MB`,
        "",
      ]
        .join(" | ")
        .trim(),
    ),
  ];
  return [START, intro, ...sections, "### Benchmarks", table.join("\n"), machine, END].join("\n\n");
}

const examples: Example[] = JSON.parse(await readFile(join(examplesDir, "repos.json"), "utf8"));
const selected = values.only?.length
  ? examples.filter((example) => values.only?.includes(example.name))
  : examples;

const benchmarksPath = join(examplesDir, "benchmarks.json");
const previous: { machine?: Machine; benchmarks: Benchmark[] } = existsSync(benchmarksPath)
  ? JSON.parse(await readFile(benchmarksPath, "utf8"))
  : { benchmarks: [] };
const byName = new Map(previous.benchmarks.map((b) => [b.name, b]));
let machine: Machine;
if (values.readme && previous.machine) {
  machine = previous.machine;
} else {
  for (const example of selected) {
    byName.set(example.name, await measure(example));
  }
  const gitVersion = (await run(["git", "--version"])).out.replace("git version ", "");
  machine = {
    cpu: cpus()[0]?.model ?? "unknown",
    memoryGB: Math.round(totalmem() / 1024 ** 3),
    os: `${platform()} ${release()}`,
    bun: Bun.version,
    git: gitVersion,
    date: new Date().toISOString().slice(0, 10),
  };
}
// Only the examples still listed: removing one from repos.json drops its benchmark too
const benchmarks = examples.flatMap((example) => byName.get(example.name) ?? []);
await writeFile(benchmarksPath, `${JSON.stringify({ machine, benchmarks }, null, 2)}\n`);

const machineLine =
  `Measured on ${machine.date} with an ${machine.cpu} (${machine.memoryGB} GB), Bun ${machine.bun} ` +
  `and git ${machine.git}, time zone UTC. *First-parent* commits are the ones on the default ` +
  "branch itself: a merged pull request counts once, however many commits it had. *Measured* " +
  "are the days with at least one of them. The data file is collected with the dimensions of the " +
  "config (format version 2). *Daily update* is a second collect right after the " +
  "full one: it measures the last stored day again, like a scheduled run. Peak memory is the " +
  "Bun process, without the git processes it starts. Regenerate with `bun run examples`.";
const readme = await readFile(readmePath, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start < 0 || end < 0) {
  throw new Error(`README.md has no ${START} … ${END} section`);
}
await writeFile(
  readmePath,
  readme.slice(0, start) +
    (await markdown(examples, benchmarks, machineLine)) +
    readme.slice(end + END.length),
);
console.log(`Updated ${relative(root, benchmarksPath)} and README.md`);
