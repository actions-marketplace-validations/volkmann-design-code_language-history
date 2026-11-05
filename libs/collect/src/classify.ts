export const NO_EXTENSION = "(none)";

export const DEFAULT_ALIASES: Record<string, string> = {
  cjs: "js",
  mjs: "js",
  cts: "ts",
  mts: "ts",
  yaml: "yml",
  htm: "html",
  markdown: "md",
  jsonc: "json",
  jpeg: "jpg",
};

export interface ClassifyOptions {
  aliases: Record<string, string>;
  excludeExt: string[];
  exclude: string[];
}

export interface Classifier {
  /** The (aliased) extension a path counts towards, or `null` when it is excluded. */
  classify(path: string): string | null;
}

/** Lower-cased extension; dotfiles count as their name (`.gitignore` -> `gitignore`). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot === 0) {
    return name.slice(1);
  }
  if (dot < 0 || dot === name.length - 1) {
    return NO_EXTENSION;
  }
  return name.slice(dot + 1);
}

export function createClassifier(options: ClassifyOptions): Classifier {
  const excludedExt = new Set(options.excludeExt.map((e) => e.replace(/^\./, "").toLowerCase()));
  const globs = options.exclude.map((pattern) => new Bun.Glob(pattern));
  return {
    classify(path) {
      const raw = extensionOf(path);
      const ext = options.aliases[raw] ?? raw;
      const excluded =
        excludedExt.has(raw) || excludedExt.has(ext) || globs.some((glob) => glob.match(path));
      return excluded ? null : ext;
    },
  };
}
