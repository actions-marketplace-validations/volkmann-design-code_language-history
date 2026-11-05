import { describe, expect, test } from "bun:test";
import { linguistDefaults } from "./linguist";

const generated = (path: string) => linguistDefaults(path).generated;
const vendored = (path: string) => linguistDefaults(path).vendored;

describe("linguistDefaults", () => {
  test("lock files are generated, wherever they are", () => {
    for (const path of [
      "yarn.lock",
      "packages/app/package-lock.json",
      "pnpm-lock.yaml",
      "Cargo.lock",
      "go.sum",
      "bun.lock",
    ]) {
      expect(generated(path)).toBe(true);
    }
    expect(generated("docs/lockfiles.md")).toBe(false);
    expect(generated("src/yarn.lock.ts")).toBe(false);
  });

  test("minified files, source maps and generated code", () => {
    expect(generated("public/app.min.js")).toBe(true);
    expect(generated("public/app-min.css")).toBe(true);
    expect(generated("dist/app.js.map")).toBe(true);
    expect(generated("api/service.pb.go")).toBe(true);
    expect(generated("api/service_pb2.py")).toBe(true);
    expect(generated("src/__generated__/Query.graphql.ts")).toBe(true);
    expect(generated("src/admin.js")).toBe(false);
    expect(generated("src/sitemap.ts")).toBe(false);
  });

  test("dependency folders are vendored at any depth", () => {
    expect(vendored("node_modules/react/index.js")).toBe(true);
    expect(vendored("web/vendor/jquery.js")).toBe(true);
    expect(vendored("third_party/zlib/zlib.h")).toBe(true);
    expect(vendored("dist/bundle.js")).toBe(true);
    expect(vendored(".yarn/releases/yarn-4.0.0.cjs")).toBe(true);
    expect(vendored("gradlew")).toBe(true);
    expect(vendored("src/vendors.ts")).toBe(false);
    expect(vendored("src/distance.ts")).toBe(false);
  });
});
