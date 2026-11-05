import { describe, expect, test } from "bun:test";
import { REST } from "@language-history/format";
import { createPathValue } from "./dimensions";

describe("dirs", () => {
  const value = createPathValue({ name: "package", dirs: ["packages/*", "./apps/*/"] });

  test("a file belongs to the matching directory it is in, named by its path", () => {
    expect(value("packages/core/src/index.ts")).toBe("packages/core");
    expect(value("packages/core/README.md")).toBe("packages/core");
    expect(value("apps/web/main.ts")).toBe("apps/web");
  });

  test("files outside every matching directory are the rest", () => {
    expect(value("packages/README.md")).toBe(REST);
    expect(value("tools/build.ts")).toBe(REST);
    expect(value("package.json")).toBe(REST);
  });

  test("the first pattern that matches wins", () => {
    const nested = createPathValue({ name: "dir", dirs: ["libs/*/*", "libs/*"] });
    expect(nested("libs/ui/button/index.ts")).toBe("libs/ui/button");
    expect(nested("libs/ui/index.ts")).toBe("libs/ui");
  });
});

describe("groups", () => {
  const value = createPathValue({
    name: "layer",
    groups: {
      tests: ["**/*.test.ts", "tests/**"],
      app: ["src/**"],
    },
  });

  test("a file belongs to the first group with a matching glob", () => {
    expect(value("src/a.test.ts")).toBe("tests");
    expect(value("src/a.ts")).toBe("app");
    expect(value("tests/fixture.json")).toBe("tests");
  });

  test("files no group matches are the rest", () => {
    expect(value("README.md")).toBe(REST);
  });
});
