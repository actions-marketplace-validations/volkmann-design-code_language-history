# language-history

**GitHub's language bar over time, in your README.**

A stacked chart of the lines of code in a repository per file extension, one column per day, kept
up to date by a scheduled job and embedded as an SVG that follows the viewer's light/dark mode.

- **Counts what GitHub counts:** files marked `linguist-generated` or `linguist-vendored` in
  `.gitattributes` are left out, like in GitHub's language statistics. One generated schema file
  can otherwise outweigh all hand-written code.
- **One value per calendar day:** the last commit of each day on the branch's first-parent
  history, in a time zone you choose. Days without commits carry the previous value over.
- **Data first:** `collect` writes plain JSONL, `render` turns it into SVG or PNG. Use either.
- **Fast and incremental:** reads git objects directly, caches counts per blob, and only measures
  new days. A 5,000-commit history takes ~40 s once, a daily update well under a second.

> Status: pre-release, no tagged version yet. Pin the action to a commit until `v1` exists.

## GitHub Action

```yaml
name: language-history
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

permissions:
  contents: write # to commit the data and the chart

jobs:
  chart:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # every day's commit has to be readable
      - uses: volkmann-design-code/language-history@<commit>
        with:
          tz: Europe/Berlin
          data: docs/language-history.jsonl
          out: docs/language-history.svg
```

Then embed the chart in your README:

```markdown
![Lines of code over time](docs/language-history.svg)
```

Each run measures the days since the last run, renders the chart and, when anything changed,
commits both files (`chore: update language history [skip ci]`) to the branch the workflow runs
on. The first run measures the whole history. A shallow checkout works too, the action fetches
the rest, but `fetch-depth: 0` is faster.

| Input | Default | |
|---|---|---|
| `config` | | JSON config file with any setting (see [Configuration](#configuration)); the inputs below override it |
| `data` | `language-history.jsonl` | JSONL data file, committed so the next run is incremental |
| `out` | `language-history.svg` | Chart files (`.svg` or `.png`), comma- or newline-separated |
| `ref` | the checked-out `HEAD` | Branch or ref whose first-parent history is measured |
| `tz` | the runner's (UTC on GitHub-hosted runners) | IANA time zone that defines a day |
| `commit` | `true` | Commit and push the data and chart files when they changed |
| `commit-message` | `chore: update language history [skip ci]` | |
| `branch` | the branch the workflow runs on | Branch to push to; pull requests are never pushed |

Outputs: `total` (lines on the last day), `date` (last day), `changed`, `committed`, `data`,
`outputs`. The job summary lists the largest extensions.

## CLI

Until the package is published, run it from a checkout with [Bun](https://bun.sh):

```bash
bun install
# 1. data: one JSONL line per day (incremental)
bun language-history collect --repo ../my-repo --ref main --data my-repo.jsonl
# 2. chart: SVG and/or PNG
bun language-history render --data my-repo.jsonl -o my-repo.svg -o my-repo.png
```

`bun language-history --help` lists every option.

## Configuration

Every option can live in a JSON config file (`-c` for the CLI, `config` for the action); flags
and inputs win over it. Unknown keys are an error.

| Key | Default | |
|---|---|---|
| `data` | `language-history.jsonl` | JSONL data file |
| `repo` | `.` | Repository root |
| `ref` | `HEAD` | Branch or ref whose first-parent history is measured |
| `tz` | the machine's | IANA time zone that defines a day |
| `paths` | all | Only count these paths (git pathspecs) |
| `linguist` | `true` | Skip `linguist-generated` / `linguist-vendored` files |
| `exclude` | | Globs to skip, e.g. `**/generated/**` |
| `excludeExt` | | Extensions to skip, e.g. `["svg", "json"]` |
| `aliases` | see [Counting](#counting) | Count one extension as another, e.g. `{ "tsx": "ts" }` |
| `defaultAliases` | `true` | Keep the built-in aliases |
| `until` | day of the newest commit | Fill days up to `YYYY-MM-DD` or `today` |
| `full` | `false` | Ignore existing data, collect everything again |
| `out` | `["language-history.svg"]` | Chart files, `.svg` or `.png` |
| `threshold` | `0.03` | Own band once an extension's peak reaches this share of the peak total |
| `maxBands` | `8` | Most named bands before the rest folds into "Others" (at most 8) |
| `othersListed` | `3` | Extensions named in the "Others" legend entry |
| `width`, `height` | `1200`, `460` | Chart size in pixels |
| `theme` | `auto` | `auto` (follows light/dark), `light` or `dark`; PNG uses light for `auto` |
| `title` | `Lines of code` | |
| `tooltips` | `true` | Per-day hover tooltips |
| `from`, `to` | | Limit the rendered range |

For example:

```json
{
  "ref": "main",
  "tz": "Europe/Berlin",
  "data": "docs/language-history.jsonl",
  "out": ["docs/language-history.svg"],
  "tooltips": false
}
```

## Data

```jsonl
{"meta":{"tool":"language-history","version":1,"ref":"main","tz":"Europe/Berlin","paths":[],"exclude":[],"excludeExt":[],"aliases":{"yaml":"yml"},"linguist":true,"own":["language-history.jsonl","language-history.svg"],"attributes":".gitattributes:1234"}}
{"date":"2026-01-04","commit":"3f2a…","carried":false,"total":5210,"byExt":{"ts":4100,"md":1110}}
{"date":"2026-01-05","commit":"3f2a…","carried":true,"total":5210,"byExt":{"ts":4100,"md":1110}}
```

- The first line holds the settings. If they or the `.gitattributes` files change, the next
  `collect` starts from scratch; `--full` forces that.
- Days without a commit carry the previous values over (`carried: true`).
- `byExt` holds every extension after aliases. Grouping into "Others" happens at render time, so
  the chart can change without collecting again.

## Counting

- Non-blank lines per file. Binary files (a NUL byte in the first 8000 bytes, like git) count 0.
- Read straight from git objects (`ls-tree` + `cat-file --batch`), no checkout.
- A day is the committer date in `--tz`, by default the machine's time zone (UTC on GitHub
  runners).
- `linguist-generated` / `linguist-vendored` files are skipped (`--no-linguist` counts them). The
  checkout's `.gitattributes` apply to every day, so marking a file today removes it from the
  whole history.
- The tool's own files (the data file and the charts) are never counted, and a commit that only
  changes them is not a commit day, so updating the chart doesn't change the chart.
- Nothing else is excluded by default. Scope with `--path` (git pathspecs), skip with `--exclude`
  (globs) and `--exclude-ext`.
- Extension = text after the last dot, lower-cased; dotfiles count as their name (`.gitignore` →
  `gitignore`), files without one as `(none)`. Default aliases (`mjs`/`cjs` → `js`, `mts`/`cts` →
  `ts`, `yaml` → `yml`, …) can be extended (`--alias tsx=ts`), undone one by one
  (`--alias yaml=yaml`) or dropped (`--no-default-aliases`).

## Chart

- An extension gets its own band once its peak reaches `--threshold` (3 %) of the peak total; at
  most 8 named bands (one per palette hue), the rest is "Others". Its legend entry says how many
  extensions it holds and names the largest (`--others-listed`, default 3).
- Bands are ordered by their size on the last day, largest at the bottom.
- `--theme auto` (default) follows the viewer's light/dark setting through a media query inside
  the SVG, which also works when the SVG is embedded in a GitHub README. PNG gets one concrete
  theme.
- Per-day hover tooltips only work when the SVG is opened directly, not when it is embedded with
  `<img>`; turn them off there (`"tooltips": false`) for a much smaller file.

## Repository layout

An Nx monorepo on Bun workspaces. Libraries are imported by name (`@language-history/*`) through
`tsconfig.json` paths.

| Project | Path | What it is | Runs in |
|---|---|---|---|
| `@language-history/format` | `libs/format` | The JSONL data format: types, parse, serialize (`./file`: read/write files) | browser, Bun |
| `@language-history/collect` | `libs/collect` | Walks a git history and measures each day | Bun + git |
| `@language-history/chart` | `libs/chart` | Bands and the SVG chart (`./png`: rasterize, `./files`: render files) | browser, Bun |
| `@language-history/options` | `libs/options` | Settings: config file, overrides, defaults | Bun |
| `@language-history/cli` | `apps/cli` | The `language-history` command | Bun |
| `@language-history/action` | `apps/action` | The GitHub Action, run by the root `action.yml` | Bun + git |

Entry points listed under `browserSafe` in a package's `package.json` must not import Node, Bun or
another package's non-browser entry point, so a web app can use them.

```bash
bun install            # also installs the lefthook git hooks
bun run check          # biome
bun run typecheck      # nx run-many -t typecheck
bun run test           # nx run-many -t test:unit
```

## Roadmap

- `v1` release and Marketplace listing.
- npm package with a bundled CLI (`bunx language-history`).
- Web app: render any published JSONL, compare repositories.

## Prior art

- [git-of-theseus](https://github.com/erikbern/git-of-theseus): lines per extension and cohorts
  over time, matplotlib plots.
- [scc](https://github.com/boyter/scc) `--timeline`: languages over a commit window, HTML report.
- [git-loc](https://github.com/banteg/git-loc): per-language lines along first-parent history, CSV
  and line chart.
- [git strata](https://github.com/vdavid/gitstrata): in-browser analysis of public repos, stacked
  by language, interactive.
- [loc-graph-action](https://github.com/botforge-pro/loc-graph-action) and
  [lines-of-code-history](https://github.com/PaulGoldschmidt/lines-of-code-history): total lines
  over time as a README chart.
