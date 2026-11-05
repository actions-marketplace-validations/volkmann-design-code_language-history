import { type DayRecord, type Meta, sameSettings } from "@language-history/format";
import { readDataset, writeDataset } from "@language-history/format/file";
import { createClassifier } from "./classify";
import { countNonBlankLines } from "./count";
import {
  attributesFingerprint,
  firstParentCommits,
  listBlobs,
  pathsWithAttributes,
  readBlobs,
} from "./git";

const LINGUIST_ATTRIBUTES = ["linguist-generated", "linguist-vendored"];

export interface CollectOptions {
  repo: string;
  out: string;
  /** `attributes` is filled in here from the tip's .gitattributes. */
  meta: Omit<Meta, "attributes">;
  /** Last day to fill (YYYY-MM-DD); defaults to the day of the newest commit. */
  until?: string;
  /** Ignore existing data and collect everything again. */
  full: boolean;
  log: (message: string) => void;
}

export function dayFormatter(tz: string): (unixSeconds: number) => string {
  // en-CA formats as YYYY-MM-DD
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (unixSeconds) => format.format(new Date(unixSeconds * 1000));
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function collect(options: CollectOptions): Promise<void> {
  const { repo, log } = options;
  const toDay = dayFormatter(options.meta.tz);

  // Newest first, so the first commit seen per day is that day's last one.
  const commits = await firstParentCommits(repo, options.meta.ref);
  if (commits.length === 0) {
    throw new Error(`No commits on ${options.meta.ref}`);
  }

  // The checkout's .gitattributes decide for the whole history, so marking a file as generated
  // now removes it from past days too.
  const attributes = options.meta.linguist ? await attributesFingerprint(repo) : "";
  const meta: Meta = { ...options.meta, attributes };
  const lastCommitOfDay = new Map<string, string>();
  for (const commit of commits) {
    const day = toDay(commit.time);
    if (!lastCommitOfDay.has(day)) {
      lastCommitOfDay.set(day, commit.sha);
    }
  }
  const commitDays = [...lastCommitOfDay.keys()].sort();
  const firstDay = commitDays[0];
  const lastDay = options.until ?? commitDays[commitDays.length - 1];

  // Resume: keep everything before the last stored day, that day may have gained commits since.
  const existing = await readDataset(options.out);
  let days: DayRecord[] = [];
  if (!options.full && existing.meta && sameSettings(existing.meta, meta)) {
    const resumeFrom = existing.days[existing.days.length - 1]?.date;
    days = existing.days.filter((day) => resumeFrom && day.date < resumeFrom);
    if (days.length) {
      log(`Resuming after ${days[days.length - 1].date} (${days.length} days kept)`);
    }
  } else if (existing.meta) {
    log(options.full ? "Full run requested" : "Settings changed, collecting from scratch");
  }

  const classifier = createClassifier(meta);
  const linesByBlob = new Map<string, number | null>();
  const linguistExcluded = new Map<string, boolean>();

  async function measure(sha: string): Promise<Record<string, number>> {
    const blobs = await listBlobs(repo, sha, meta.paths);
    if (attributes) {
      const unchecked = blobs
        .map((blob) => blob.path)
        .filter((path) => !linguistExcluded.has(path));
      const marked = await pathsWithAttributes(repo, LINGUIST_ATTRIBUTES, unchecked);
      for (const path of unchecked) {
        linguistExcluded.set(path, marked.has(path));
      }
    }
    const counted = blobs.filter(
      (blob) => !linguistExcluded.get(blob.path) && classifier.classify(blob.path) !== null,
    );
    const unknown = new Map<string, number>();
    for (const blob of counted) {
      if (!linesByBlob.has(blob.sha)) {
        unknown.set(blob.sha, blob.size);
      }
    }
    await readBlobs(
      repo,
      [...unknown].map(([sha, size]) => ({ sha, size })),
      (blobSha, content) => linesByBlob.set(blobSha, countNonBlankLines(content)),
    );
    const byExt: Record<string, number> = {};
    for (const blob of counted) {
      const lines = linesByBlob.get(blob.sha);
      const ext = classifier.classify(blob.path);
      if (!lines || ext === null) {
        continue; // binary, empty or excluded
      }
      byExt[ext] = (byExt[ext] ?? 0) + lines;
    }
    return Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1]));
  }

  let previous = days[days.length - 1];
  let day = previous ? nextDay(previous.date) : firstDay;
  const started = performance.now();
  let measured = 0;
  while (day <= lastDay) {
    const sha = lastCommitOfDay.get(day);
    if (sha) {
      const byExt = await measure(sha);
      const total = Object.values(byExt).reduce((sum, n) => sum + n, 0);
      previous = { date: day, commit: sha, carried: false, total, byExt };
      measured++;
      if (measured % 50 === 0) {
        log(`${day}  ${measured} commits measured`);
      }
    } else if (previous) {
      previous = { ...previous, date: day, carried: true };
    }
    if (previous) {
      days.push(previous);
    }
    day = nextDay(day);
  }

  await writeDataset(options.out, { meta, days });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  log(`Wrote ${days.length} days to ${options.out} (${measured} commits measured in ${seconds}s)`);
}
