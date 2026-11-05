import { OTHERS } from "./bands";
import { LINGUIST_COLORS } from "./linguist-colors";

export type Scheme = "light" | "dark";

export interface SchemeColors {
  surface: string;
  /** Fallback colors for extensions GitHub has no color for, picked by the extension's name. */
  series: string[];
  others: string;
}

/**
 * Minimum contrast of a GitHub color against the chart surface. GitHub uses the same colors on
 * light and dark backgrounds, so near-black ones (JSON, `.gitignore`) would vanish in dark mode;
 * those get lightened until they stand out, clear of the gray Others band. The light bound only
 * catches near-white colors.
 */
const MIN_CONTRAST: Record<Scheme, number> = { light: 1.2, dark: 3 };

/**
 * The color of an extension's band: the override if there is one (used as is, in both schemes),
 * else GitHub's language color, else a fallback chosen by the extension's name. The same
 * extension gets the same color in every chart, whatever its rank.
 */
export function bandColor(
  key: string,
  scheme: Scheme,
  palette: SchemeColors,
  overrides: Record<string, string> = {},
): string {
  const override = overrides[key];
  if (override) {
    return override;
  }
  if (key === OTHERS) {
    return palette.others;
  }
  const github = LINGUIST_COLORS[key];
  if (github) {
    return withContrast(github, palette.surface, MIN_CONTRAST[scheme]);
  }
  return palette.series[nameHash(key) % palette.series.length];
}

/** FNV-1a, so fallback colors are stable across runs and machines. */
function nameHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    return null;
  }
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a) ?? [0, 0, 0]);
  const lb = luminance(parseHex(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color` mixed towards white (dark surface) or black (light surface) until it reaches `min`. */
export function withContrast(color: string, surface: string, min: number): string {
  const rgb = parseHex(color);
  const bg = parseHex(surface);
  if (!rgb || !bg || contrast(color, surface) >= min) {
    return color;
  }
  const target = luminance(bg) < 0.5 ? 255 : 0;
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex(rgb.map((v) => v + (target - v) * t) as Rgb);
    if (contrast(mixed, surface) >= min) {
      return mixed;
    }
  }
  return toHex([target, target, target]);
}
