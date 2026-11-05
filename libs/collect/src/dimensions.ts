import { type Dimension, REST } from "@language-history/format";

/** A dimension whose value only depends on the file's path; `ext` is handled by the classifier. */
export type PathDimension = Exclude<Dimension, { name: "ext" }>;

/** The value of a path dimension for a path: its directory or group, else `REST`. */
export function createPathValue(dimension: PathDimension): (path: string) => string {
  if ("dirs" in dimension) {
    const patterns = dimension.dirs.map((pattern) => {
      const clean = pattern.replace(/^\.?\/+|\/+$/g, "");
      return { glob: new Bun.Glob(clean), depth: clean.split("/").length };
    });
    return (path) => {
      const segments = path.split("/");
      for (const { glob, depth } of patterns) {
        // Only files inside the directory, not a file that matches the pattern itself
        if (segments.length > depth) {
          const dir = segments.slice(0, depth).join("/");
          if (glob.match(dir)) {
            return dir;
          }
        }
      }
      return REST;
    };
  }
  const groups = Object.entries(dimension.groups).map(([name, globs]) => ({
    name,
    globs: globs.map((pattern) => new Bun.Glob(pattern)),
  }));
  return (path) =>
    groups.find((group) => group.globs.some((glob) => glob.match(path)))?.name ?? REST;
}
