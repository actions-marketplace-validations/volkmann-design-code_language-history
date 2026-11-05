import type { DayRecord } from "@language-history/format";

export const OTHERS = "Others";

export interface Bands {
  /** Bottom to top; `OTHERS` last when present. */
  keys: string[];
  /** values[day][band], aligned with `keys`. */
  values: number[][];
  /** Extensions inside Others on the last day, largest first. */
  others: string[];
}

export interface BandOptions {
  /**
   * An extension gets its own band when its peak reaches this share of the peak total.
   * Measured against the peak, not per day, so the tiny first days of a repo don't decide the bands.
   */
  threshold: number;
  /** Most named bands (the categorical palette has 8 hues); the rest fold into Others. */
  maxBands: number;
}

export function computeBands(days: DayRecord[], options: BandOptions): Bands {
  const peak = new Map<string, number>();
  let peakTotal = 0;
  for (const day of days) {
    peakTotal = Math.max(peakTotal, day.total);
    for (const [ext, lines] of Object.entries(day.counts)) {
      peak.set(ext, Math.max(peak.get(ext) ?? 0, lines));
    }
  }
  const last = days[days.length - 1];
  const size = (ext: string) => last?.counts[ext] ?? 0;
  const named = [...peak]
    .filter(([, lines]) => lines >= options.threshold * peakTotal)
    .map(([ext]) => ext)
    // Largest today at the bottom; ties (e.g. extensions that disappeared) by peak
    .sort((a, b) => size(b) - size(a) || (peak.get(b) ?? 0) - (peak.get(a) ?? 0))
    .slice(0, options.maxBands);

  const values = days.map((day) => {
    const row = named.map((ext) => day.counts[ext] ?? 0);
    row.push(day.total - row.reduce((sum, n) => sum + n, 0));
    return row;
  });
  const hasOthers = values.some((row) => row[row.length - 1] > 0);
  if (!hasOthers) {
    for (const row of values) {
      row.pop();
    }
  }
  const others = Object.entries(last?.counts ?? {})
    .filter(([ext, lines]) => lines > 0 && !named.includes(ext))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ext]) => ext);
  return { keys: hasOthers ? [...named, OTHERS] : named, values, others };
}
