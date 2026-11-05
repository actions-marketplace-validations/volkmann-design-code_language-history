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

/** Reads a JSONL dataset that has to be there and hold days: what render and export need. */
export async function readExistingDataset(path: string): Promise<Dataset> {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`No data file at ${path}; run collect first`);
  }
  const dataset = await readDataset(path);
  if (dataset.days.length === 0) {
    throw new Error(`${path} holds no days; run collect first`);
  }
  return dataset;
}

/** Writes a JSONL dataset atomically (temp file + rename). */
export async function writeDataset(path: string, dataset: Dataset): Promise<void> {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, serializeDataset(dataset));
  renameSync(tmp, path);
}
