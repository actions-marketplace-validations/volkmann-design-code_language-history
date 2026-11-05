import { runAction } from "./action";

try {
  await runAction({ env: process.env, cwd: process.cwd() });
} catch (error) {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
