/**
 * Built-in path rules for generated and vendored files, modelled on GitHub Linguist's
 * (generated.rb and vendor.yml). Linguist also detects generated files by their content; these
 * rules only look at paths. `.gitattributes` wins over them in both directions:
 * `linguist-generated=false` counts a file these rules would skip.
 *
 * Bump LINGUIST_RULES whenever the lists change, so existing data is collected again.
 */
export const LINGUIST_RULES = 1;

const GENERATED: RegExp[] = [
  // Lock files
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /(^|\/)(deno\.lock|composer\.lock|Gemfile\.lock|Cargo\.lock|go\.sum|Gopkg\.lock|glide\.lock)$/,
  /(^|\/)(poetry\.lock|Pipfile\.lock|pdm\.lock|uv\.lock|pixi\.lock|flake\.lock|MODULE\.bazel\.lock)$/,
  /(^|\/)(pubspec\.lock|mix\.lock|Podfile\.lock|Package\.resolved|packages\.lock\.json)$/,
  // Minified files and source maps
  /[.-]min\.(js|css)$/,
  /\.(js|cjs|mjs|css)\.map$/,
  // Code generators
  /\.pb\.(go|cc|h)$/,
  /_pb2(_grpc)?\.pyi?$/,
  /_(grpc_)?pb\.(js|d\.ts)$/,
  /\.designer\.(cs|vb)$/i,
  /(^|\/)__generated__\//,
  // Yarn Plug'n'Play
  /(^|\/)\.pnp\.(c?js|loader\.mjs)$/,
];

const VENDORED: RegExp[] = [
  // Dependency folders
  /(^|\/)(node_modules|bower_components|jspm_packages)\//,
  /(^|\/)[Vv]endors?\//,
  /(^|\/)[Tt]hird[-_]?[Pp]arty\//,
  /(^|\/)(Pods|Carthage)\//,
  /(^|\/)Godeps\/_workspace\//,
  /(^|\/)dist\//,
  // Package manager and build tool releases checked into the repository
  /(^|\/)\.yarn\/(releases|plugins|sdks|versions|unplugged)\//,
  /(^|\/)gradlew(\.bat)?$/,
  /(^|\/)gradle\/wrapper\//,
  /(^|\/)mvnw(\.cmd)?$/,
  /(^|\/)\.mvn\/wrapper\//,
  // Common copied-in libraries
  /(^|\/)jquery([^/.]*)\.js$/,
];

/** Whether the built-in rules treat `path` as generated and/or vendored. */
export function linguistDefaults(path: string): { generated: boolean; vendored: boolean } {
  return {
    generated: GENERATED.some((rule) => rule.test(path)),
    vendored: VENDORED.some((rule) => rule.test(path)),
  };
}
