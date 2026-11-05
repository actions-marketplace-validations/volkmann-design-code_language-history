/** First line of the JSONL file: the settings the data was collected with. */
export interface Meta {
  tool: "language-history";
  version: 1;
  ref: string;
  tz: string;
  paths: string[];
  exclude: string[];
  excludeExt: string[];
  aliases: Record<string, string>;
  /** Skip files marked linguist-generated / linguist-vendored in the checkout's .gitattributes. */
  linguist: boolean;
  /** Fingerprint of the checkout's .gitattributes files, so edits to them trigger a full run. */
  attributes: string;
}

/** One line per calendar day. */
export interface DayRecord {
  date: string;
  /** Last first-parent commit of that day, or of the last day with a commit when `carried`. */
  commit: string;
  /** No commit on this day; values are carried over from the previous one. */
  carried: boolean;
  total: number;
  byExt: Record<string, number>;
}

export interface Dataset {
  meta: Meta | null;
  days: DayRecord[];
}

export function parseDataset(text: string): Dataset {
  let meta: Meta | null = null;
  const days: DayRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line);
    if (row.meta) {
      meta = row.meta;
    } else {
      days.push(row);
    }
  }
  return { meta, days };
}

export function serializeDataset(dataset: Dataset): string {
  const lines = [
    ...(dataset.meta ? [JSON.stringify({ meta: dataset.meta })] : []),
    ...dataset.days.map((day) => JSON.stringify(day)),
  ];
  return `${lines.join("\n")}\n`;
}

export function sameSettings(a: Meta, b: Meta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
