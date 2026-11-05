import { renameSync } from "node:fs";
import { type Dataset, parseDataset, serializeDataset } from "./dataset";

/** Reads a JSONL dataset; a missing file is an empty dataset. */
export async function readDataset(path: string): Promise<Dataset> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { meta: null, days: [] };
  }
  return parseDataset(await file.text());
}

/** Writes a JSONL dataset atomically (temp file + rename). */
export async function writeDataset(path: string, dataset: Dataset): Promise<void> {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, serializeDataset(dataset));
  renameSync(tmp, path);
}
