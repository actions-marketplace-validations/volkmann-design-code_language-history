import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Meta } from "@language-history/format";
import { readDataset } from "@language-history/format/file";
import { collect, nextDay } from "./collect";

// Integration tests against throwaway git repositories with controlled commit dates.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), "language-history-test-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);

  const git = (args: string[], date?: string) => {
    const result = Bun.spawnSync(
      ["git", "-C", repo, "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
      {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@example.com",
          ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
        },
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    }
    return result.stdout.toString().trim();
  };
  git(["init", "-q", "-b", "main"]);

  return {
    root,
    repo,
    git,
    write(files: Record<string, string | Uint8Array>) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, path)), { recursive: true });
        writeFileSync(join(repo, path), content);
      }
    },
    /** Commits everything in the working tree at `date` (ISO), returns the sha. */
    commit(date: string, files: Record<string, string | Uint8Array> = {}) {
      this.write(files);
      git(["add", "-A"]);
      git(["commit", "-q", "--allow-empty", "-m", `commit at ${date}`], date);
      return git(["rev-parse", "HEAD"]);
    },
    async collect(
      meta: Partial<Omit<Meta, "attributes">> = {},
      options: { until?: string; full?: boolean; out?: string } = {},
    ) {
      const logs: string[] = [];
      const out = options.out ?? join(root, "data.jsonl");
      await collect({
        repo,
        out,
        meta: {
          tool: "language-history",
          version: 1,
          ref: "main",
          tz: "UTC",
          paths: [],
          exclude: [],
          excludeExt: [],
          aliases: {},
          linguist: true,
          ...meta,
        },
        until: options.until,
        full: options.full ?? false,
        log: (message) => logs.push(message),
      });
      return { ...(await readDataset(out)), logs };
    },
  };
}

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}\n\n`).join("");

describe("nextDay", () => {
  test("crosses month and year boundaries", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("collect", () => {
  test("measures the last commit of each day and carries values over days without commits", async () => {
    const r = createRepo();
    r.commit("2026-01-01T09:00:00Z", { "src/a.ts": lines(2), "README.md": lines(1) });
    const lastOfDay1 = r.commit("2026-01-01T18:00:00Z", { "src/a.ts": lines(3) });
    const day4 = r.commit("2026-01-04T10:00:00Z", { "src/b.ts": lines(5) });

    const { days } = await r.collect();

    expect(days.map((d) => [d.date, d.commit, d.carried, d.total])).toEqual([
      ["2026-01-01", lastOfDay1, false, 4],
      ["2026-01-02", lastOfDay1, true, 4],
      ["2026-01-03", lastOfDay1, true, 4],
      ["2026-01-04", day4, false, 9],
    ]);
    expect(days[3].byExt).toEqual({ ts: 8, md: 1 });
  });

  test("follows first parents only: a merged branch shows up on the merge day", async () => {
    const r = createRepo();
    const base = r.commit("2026-01-01T09:00:00Z", { "a.ts": lines(1) });
    r.git(["checkout", "-q", "-b", "side"]);
    r.commit("2026-01-02T09:00:00Z", { "side.ts": lines(10) });
    r.git(["checkout", "-q", "main"]);
    r.git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], "2026-01-03T09:00:00Z");
    const merge = r.git(["rev-parse", "HEAD"]);

    const { days } = await r.collect();

    expect(days.map((d) => [d.date, d.commit, d.total])).toEqual([
      ["2026-01-01", base, 1],
      ["2026-01-02", base, 1],
      ["2026-01-03", merge, 11],
    ]);
  });

  test("the time zone decides which day a commit belongs to", async () => {
    const r = createRepo();
    r.commit("2026-01-01T12:00:00Z", { "a.ts": lines(1) });
    r.commit("2026-01-01T23:30:00Z", { "a.ts": lines(2) });

    const utc = await r.collect({ tz: "UTC" });
    expect(utc.days.map((d) => [d.date, d.total])).toEqual([["2026-01-01", 2]]);

    const berlin = await r.collect({ tz: "Europe/Berlin" });
    expect(berlin.days.map((d) => [d.date, d.total])).toEqual([
      ["2026-01-01", 1],
      ["2026-01-02", 2],
    ]);
  });

  test("--until fills carried days after the newest commit", async () => {
    const r = createRepo();
    const sha = r.commit("2026-01-01T12:00:00Z", { "a.ts": lines(1) });

    const { days } = await r.collect({}, { until: "2026-01-03" });

    expect(days.map((d) => [d.date, d.commit, d.carried])).toEqual([
      ["2026-01-01", sha, false],
      ["2026-01-02", sha, true],
      ["2026-01-03", sha, true],
    ]);
  });

  test("applies paths, aliases and exclusions", async () => {
    const r = createRepo();
    r.commit("2026-01-01T12:00:00Z", {
      "src/a.ts": lines(1),
      "src/b.mts": lines(2),
      "src/generated/c.ts": lines(4),
      "src/d.json": lines(8),
      "docs/e.md": lines(16),
    });

    const { days } = await r.collect({
      paths: ["src"],
      aliases: { mts: "ts" },
      exclude: ["**/generated/**"],
      excludeExt: ["json"],
    });

    expect(days[0].byExt).toEqual({ ts: 3 });
  });

  test("skips binary and empty files", async () => {
    const r = createRepo();
    r.commit("2026-01-01T12:00:00Z", {
      "a.ts": lines(1),
      "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x41, 0x0a]),
      "empty.txt": "\n\n",
    });

    const { days } = await r.collect();

    expect(days[0].byExt).toEqual({ ts: 1 });
  });

  test("the checkout's linguist attributes apply to the whole history", async () => {
    const r = createRepo();
    r.commit("2026-01-01T12:00:00Z", {
      "a.ts": lines(1),
      "gen.ts": lines(5),
      "v/lib.js": lines(7),
    });
    r.commit("2026-01-02T12:00:00Z", { "gen.ts": lines(6) });
    // Not committed: attributes in the working tree still decide for all days
    r.write({ ".gitattributes": "gen.ts linguist-generated\nv/** linguist-vendored\n" });

    const skipped = await r.collect();
    expect(skipped.days.map((d) => d.byExt)).toEqual([{ ts: 1 }, { ts: 1 }]);
    expect(skipped.meta?.attributes).toContain(".gitattributes:");

    const counted = await r.collect({ linguist: false });
    expect(counted.days.map((d) => d.byExt)).toEqual([
      { js: 7, ts: 6 },
      { js: 7, ts: 7 },
    ]);
    expect(counted.meta?.attributes).toBe("");
  });

  test("an incremental run gives the same result as a full run", async () => {
    const r = createRepo();
    r.commit("2026-01-01T12:00:00Z", { "a.ts": lines(1) });
    r.commit("2026-01-03T09:00:00Z", { "a.ts": lines(2) });
    const first = await r.collect();
    expect(first.days).toHaveLength(3);

    // The last stored day gains a commit, and new days follow
    const laterSameDay = r.commit("2026-01-03T20:00:00Z", { "a.ts": lines(3) });
    r.commit("2026-01-05T09:00:00Z", { "b.md": lines(4) });
    const incremental = await r.collect();
    const full = await r.collect({}, { full: true, out: join(r.root, "full.jsonl") });

    expect(incremental.logs[0]).toBe("Resuming after 2026-01-02 (2 days kept)");
    expect(incremental.days.find((d) => d.date === "2026-01-03")?.commit).toBe(laterSameDay);
    expect(incremental.days).toEqual(full.days);
    expect(incremental.meta).toEqual(full.meta);
  });

  test("changed settings or attributes start from scratch", async () => {
    const r = createRepo();
    r.commit("2026-01-01T12:00:00Z", { "a.ts": lines(1), "b.md": lines(2) });
    r.commit("2026-01-02T12:00:00Z", { "a.ts": lines(3) });
    await r.collect();

    const changed = await r.collect({ excludeExt: ["md"] });
    expect(changed.logs[0]).toBe("Settings changed, collecting from scratch");
    expect(changed.days.map((d) => d.total)).toEqual([1, 3]);

    r.write({ ".gitattributes": "*.ts linguist-generated\n" });
    const marked = await r.collect({ excludeExt: ["md"] });
    expect(marked.logs[0]).toBe("Settings changed, collecting from scratch");
    // Nothing left: .gitattributes itself is not committed
    expect(marked.days.map((d) => d.total)).toEqual([0, 0]);

    const full = await r.collect({ excludeExt: ["md"] }, { full: true });
    expect(full.logs[0]).toBe("Full run requested");
  });
});
