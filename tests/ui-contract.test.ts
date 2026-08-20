import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const UI_ROOTS = [join(ROOT, "src/components"), join(ROOT, "src/app")];

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return extname(path) === ".tsx" ? [path] : [];
  });
}

test("UI uses the shared icon system and contains no emoji", () => {
  const violations: string[] = [];
  for (const file of UI_ROOTS.flatMap(collectTsxFiles)) {
    const source = readFileSync(file, "utf8");
    if (/<svg\b/i.test(source)) violations.push(`${relative(ROOT, file)}: inline SVG`);
    if (/\p{Extended_Pictographic}/u.test(source)) {
      violations.push(`${relative(ROOT, file)}: emoji`);
    }
  }
  assert.deepEqual(violations, []);
});
