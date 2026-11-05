import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataset, readExistingDataset, writeDataset } from "./file";

const dir = mkdtempSync(join(tmpdir(), "language-history-file-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const meta = { tool: "language-history", version: 1 } as never;

describe("readDataset", () => {
  test("a missing file is an empty dataset, for collect to start from", async () => {
    expect(await readDataset(join(dir, "missing.jsonl"))).toEqual({ meta: null, days: [] });
  });
});

describe("readExistingDataset", () => {
  test("a missing file names its path", async () => {
    const path = join(dir, "missing.jsonl");
    await expect(readExistingDataset(path)).rejects.toThrow(
      `No data file at ${path}; run collect first`,
    );
  });

  test("a file without days is an error too", async () => {
    const path = join(dir, "empty.jsonl");
    await writeDataset(path, { meta, days: [] });
    await expect(readExistingDataset(path)).rejects.toThrow(`${path} holds no days`);
  });

  test("a file with days is read", async () => {
    const path = join(dir, "days.jsonl");
    const day = { date: "2026-01-01", commit: "a", carried: false, total: 3, counts: { ts: 3 } };
    await writeDataset(path, { meta, days: [day] });
    expect((await readExistingDataset(path)).days).toEqual([day]);
  });
});
