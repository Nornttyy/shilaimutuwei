import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

test("all rigs have real, separate expression PNG variants", () => {
  const output = execFileSync(
    "python3",
    ["scripts/validate-expression-atlases.py", "--json"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const result = JSON.parse(output);

  assert.deepEqual(result, {
    atlasCount: 8,
    eyeVariantCount: 24,
    faceOnlyAtlasCount: 8,
    mouthVariantCount: 16,
    rigCount: 8,
    variantCount: 40,
  });
});
