/**
 * Counts lines that contain at least one non-whitespace character.
 * Returns `null` for binary content (a NUL byte in the first 8000 bytes, git's own heuristic).
 */
export function countNonBlankLines(content: Uint8Array): number | null {
  const probe = Math.min(content.length, 8000);
  for (let i = 0; i < probe; i++) {
    if (content[i] === 0) {
      return null;
    }
  }
  let lines = 0;
  let nonBlank = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === 10) {
      if (nonBlank) {
        lines++;
      }
      nonBlank = false;
    } else if (!nonBlank && c !== 32 && c !== 9 && c !== 13 && c !== 11 && c !== 12) {
      nonBlank = true;
    }
  }
  return nonBlank ? lines + 1 : lines;
}
