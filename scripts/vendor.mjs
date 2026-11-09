// Copy the two vendored browser libraries into ui/vendor so the app runs
// offline with no bundler. Both are installed as dev dependencies only.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = join(import.meta.dirname, "..", "ui", "vendor");
mkdirSync(out, { recursive: true });

function packageDir(pkg) {
  let dir = dirname(require.resolve(pkg));
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
  return dir;
}

const files = [
  ["marked", "lib/marked.esm.js", "marked.esm.js"],
  ["dompurify", "dist/purify.es.mjs", "purify.es.mjs"],
];

for (const [pkg, file, target] of files) {
  const source = join(packageDir(pkg), file);
  if (!existsSync(source)) throw new Error(`Missing ${pkg}/${file}`);
  copyFileSync(source, join(out, target));
  console.log(`vendored ${pkg}/${file} -> ui/vendor/${target}`);
}
