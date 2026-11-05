export interface CommitRef {
  sha: string;
  /** Committer time, unix seconds. */
  time: number;
}

export interface TreeEntry {
  sha: string;
  size: number;
  path: string;
}

async function run(repo: string, args: string[], input?: Uint8Array): Promise<Uint8Array> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${err.trim()}`);
  }
  return new Uint8Array(out);
}

const decoder = new TextDecoder();

/**
 * Commits along the first-parent chain of `ref`, newest first. Commits that change nothing but
 * `ignore` (repo-relative file paths) are left out.
 */
export async function firstParentCommits(
  repo: string,
  ref: string,
  ignore: string[] = [],
): Promise<CommitRef[]> {
  const pathspecs = ignore.length
    ? [":/", ...ignore.map((path) => `:(top,literal,exclude)${path}`)]
    : [];
  const out = decoder.decode(
    await run(repo, ["log", "--first-parent", "--format=%H %ct", ref, "--", ...pathspecs]),
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, time] = line.split(" ");
      return { sha, time: Number(time) };
    });
}

/** All blobs of a commit's tree (submodules and symlinks skipped), limited to git pathspecs. */
export async function listBlobs(
  repo: string,
  commit: string,
  pathspecs: string[],
): Promise<TreeEntry[]> {
  const out = decoder.decode(
    await run(repo, ["ls-tree", "-r", "-l", "-z", "--full-tree", commit, "--", ...pathspecs]),
  );
  const entries: TreeEntry[] = [];
  for (const record of out.split("\0")) {
    if (!record) {
      continue;
    }
    // "<mode> <type> <sha> <size padded>\t<path>"
    const tab = record.indexOf("\t");
    const [mode, type, sha, size] = record.slice(0, tab).split(/\s+/);
    if (type !== "blob" || mode === "120000") {
      continue;
    }
    entries.push({ sha, size: Number(size), path: record.slice(tab + 1) });
  }
  return entries;
}

/** Content fingerprint of the working tree's .gitattributes files (empty when there are none). */
export async function attributesFingerprint(repo: string): Promise<string> {
  const toplevel = decoder.decode(await run(repo, ["rev-parse", "--show-toplevel"])).trim();
  const files = decoder
    .decode(
      await run(repo, [
        "ls-files",
        "-co",
        "--exclude-standard",
        "--full-name",
        "-z",
        "--",
        ":/*.gitattributes",
      ]),
    )
    .split("\0")
    .filter((path) => path === ".gitattributes" || path.endsWith("/.gitattributes"))
    .sort();
  const parts = await Promise.all(
    files.map(async (path) => `${path}:${Bun.hash(await Bun.file(`${toplevel}/${path}`).text())}`),
  );
  return parts.join(",");
}

/**
 * The `attrs` of each path, read from the working tree's .gitattributes: `true` when set,
 * `false` when unset (`-attr` or `attr=false`), missing when the attributes don't mention it.
 */
export async function booleanAttributes(
  repo: string,
  attrs: string[],
  paths: string[],
): Promise<Map<string, Record<string, boolean>>> {
  const result = new Map<string, Record<string, boolean>>();
  if (paths.length === 0) {
    return result;
  }
  const out = decoder.decode(
    await run(
      repo,
      ["check-attr", "-z", "--stdin", ...attrs],
      new TextEncoder().encode(`${paths.join("\0")}\0`),
    ),
  );
  // -z output: <path> NUL <attribute> NUL <info> NUL, repeated
  const fields = out.split("\0");
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const info = fields[i + 2];
    const value =
      info === "set" || info === "true"
        ? true
        : info === "unset" || info === "false"
          ? false
          : null;
    if (value === null) {
      continue;
    }
    const entry = result.get(fields[i]) ?? {};
    entry[fields[i + 1]] = value;
    result.set(fields[i], entry);
  }
  return result;
}

/** Streams blob contents in chunks of roughly `chunkBytes`, one `git cat-file --batch` per chunk. */
export async function readBlobs(
  repo: string,
  blobs: { sha: string; size: number }[],
  onBlob: (sha: string, content: Uint8Array) => void,
  chunkBytes = 64 * 1024 * 1024,
): Promise<void> {
  let start = 0;
  while (start < blobs.length) {
    let end = start;
    let bytes = 0;
    while (end < blobs.length && (end === start || bytes + blobs[end].size <= chunkBytes)) {
      bytes += blobs[end].size;
      end++;
    }
    const input = new TextEncoder().encode(
      `${blobs
        .slice(start, end)
        .map((b) => b.sha)
        .join("\n")}\n`,
    );
    const out = await run(repo, ["cat-file", "--batch"], input);
    let pos = 0;
    while (pos < out.length) {
      const nl = out.indexOf(10, pos);
      const header = decoder.decode(out.subarray(pos, nl)).split(" ");
      pos = nl + 1;
      if (header[1] === "missing") {
        continue;
      }
      const size = Number(header[2]);
      onBlob(header[0], out.subarray(pos, pos + size));
      pos += size + 1; // trailing newline after content
    }
    start = end;
  }
}
