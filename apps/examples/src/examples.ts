#!/usr/bin/env bun
/**
 * Regenerates the example charts in examples/ from public repositories and measures the runs.
 *
 *   bun run examples [--cache <dir>] [--only <name>]...
 *   bun run examples --readme      (only rewrite the README section from benchmarks.json)
 *
 * Each repository is cloned (or pulled) into the cache directory, then measured with the CLI as a
 * user would run it: a full collect, an incremental collect right after it (what a daily update
 * costs) and a render. Results go to examples/benchmarks.json and to the marked section of the
 * README.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDataset } from "@language-history/format";

interface Example {
  name: string;
  url: string;
  title: string;
  /** Why the example has a config file (examples/<name>.config.json), shown in the README. */
  note?: string;
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
  chartKB: number;
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
  const chart = join(examplesDir, `${example.name}.svg`);
  const configPath = join(examplesDir, `${example.name}.config.json`);
  const config = existsSync(configPath) ? ["-c", configPath] : [];
  const collect = ["bun", cli, "collect", ...config, "--repo", repo, "--ref", ref, "--tz", "UTC"];
  collect.push("--data", data);
  const title = `Lines of code in ${example.title}`;

  console.log(`${example.title}: full collect`);
  const full = (await run([...collect, "--full"])).run;
  console.log(`${example.title}: incremental collect`);
  const incremental = (await run(collect)).run;
  console.log(`${example.title}: render`);
  const render = (
    await run([
      "bun",
      cli,
      "render",
      ...config,
      "--data",
      data,
      "-o",
      chart,
      "--no-tooltips",
      "--title",
      title,
    ])
  ).run;

  const dataset = parseDataset(await readFile(data, "utf8"));
  const last = dataset.days[dataset.days.length - 1];
  const extensions = new Set(dataset.days.flatMap((day) => Object.keys(day.counts)));
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
    chartKB: Math.round((await stat(chart)).size / 1024),
    full,
    incremental,
    render,
  };
}

const int = (n: number) => n.toLocaleString("en-US");
const duration = (seconds: number) =>
  seconds < 10
    ? `${seconds < 0.1 ? "< 0.1" : seconds.toFixed(1)} s`
    : seconds < 60
      ? `${Math.round(seconds)} s`
      : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;

function markdown(examples: Example[], benchmarks: Benchmark[], machine: string): string {
  const charts = benchmarks.map((b) => {
    const note = examples.find((example) => example.name === b.name)?.note;
    const config = note
      ? `\n\nWith [a config](examples/${b.name}.config.json): ${note}`
      : "\n\nDefault settings.";
    return (
      `### [${b.title}](${b.url.replace(/\.git$/, "")})\n\n` +
      `![${b.title}: lines of code per file extension over time](examples/${b.name}.svg)${config}`
    );
  });
  const table = [
    "| Repository | Commits | First-parent | Days | Measured | Lines today | Full collect | Daily update | Render | Peak memory |",
    "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|",
    ...benchmarks.map((b) =>
      [
        "",
        b.title,
        int(b.commits),
        int(b.firstParentCommits),
        int(b.days),
        int(b.measuredDays),
        int(b.lines),
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
  return [START, ...charts, "### Benchmarks", table.join("\n"), machine, END].join("\n\n");
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
const benchmarks = examples.flatMap((example) => byName.get(example.name) ?? []);
await writeFile(benchmarksPath, `${JSON.stringify({ machine, benchmarks }, null, 2)}\n`);

const machineLine =
  `Measured on ${machine.date} with an ${machine.cpu} (${machine.memoryGB} GB), Bun ${machine.bun} ` +
  `and git ${machine.git}, time zone UTC. *First-parent* commits are the ones on the default ` +
  "branch itself: a merged pull request counts once, however many commits it had. *Measured* " +
  "are the days with at least one of them. *Daily update* is a second collect right after the " +
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
    markdown(examples, benchmarks, machineLine) +
    readme.slice(end + END.length),
);
console.log(`Updated ${relative(root, benchmarksPath)} and README.md`);
