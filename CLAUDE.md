# CLAUDE.md

language-history: lines of code per file extension over time, as JSONL data and as a stacked
chart for READMEs. See README.md for behavior and the repository layout.

## Commands

```bash
bun install                 # deps + lefthook hooks
bun run check               # biome (format + lint); `bunx biome check --write .` fixes
bun run typecheck           # nx run-many -t typecheck
bun run test                # nx run-many -t test:unit (bun test per project)
bun language-history --help # the CLI from source
```

## Conventions

- Bun only, no Node-specific tooling. Tests use `bun:test`, next to the code as `*.test.ts`.
- All third-party dependencies live in the root `package.json`, pinned to exact versions. Project
  `package.json` files declare no dependencies; `@language-history/*` imports resolve through the
  root `tsconfig.json` paths. A new entry point needs an `exports` entry and a `paths` entry.
- Entry points under `browserSafe` must stay free of `node:*`, `Bun.*` and non-browser entry
  points of other packages: they are meant for a future web app.
- Libraries don't depend on apps. `format` depends on nothing; `collect` and `chart` depend on
  `format` only; `options` ties settings to `collect` and `chart`. Apps (`cli`, `action`) only
  wire libraries together.
- `action.yml` has to stay at the repo root (`uses: volkmann-design-code/language-history@…`); it
  only installs Bun and production deps and runs `apps/action/src/main.ts`.
- Nothing from private or client projects goes into this public repo: no names, paths, data or
  numbers taken from them.
- Biome formats and lints (double quotes, block statements required); lefthook runs it on commit.
- Changing the JSONL format means bumping `version` in `Meta` and handling older files.
