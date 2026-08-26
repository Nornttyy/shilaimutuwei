import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';

const ROOT_URL = new URL('../', import.meta.url);
const SCRIPT_URL = new URL('../scripts/build-shell-layered-atlas.py', import.meta.url);
const SOURCE_URL = new URL(
  '../assets/generated-v2/rig/survivor-shell-shell/layer-master-v3.png',
  import.meta.url,
);
const ATLAS_URL = new URL(
  '../assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.png',
  import.meta.url,
);
const REPORT_URL = new URL(
  '../assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.json',
  import.meta.url,
);
const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const OWNER = 'survivor-shell-shell';
const ATLAS_PATH = 'assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.png';
const EXPRESSION_PATH = 'assets/generated-v2/rig/survivor-shell-shell/expressions-v3.png';
const LAYOUT = Object.freeze({
  shellBack: Object.freeze({
    sourceRect: Object.freeze({ x: 4, y: 4, width: 496, height: 440 }),
    bindRect: Object.freeze({ x: -91, y: -120, width: 124, height: 110 }),
    componentCount: 1,
  }),
  body: Object.freeze({
    sourceRect: Object.freeze({ x: 508, y: 4, width: 408, height: 280 }),
    bindRect: Object.freeze({ x: -51, y: -70, width: 102, height: 70 }),
    componentCount: 1,
  }),
  shellFront: Object.freeze({
    sourceRect: Object.freeze({ x: 508, y: 292, width: 320, height: 256 }),
    bindRect: Object.freeze({ x: -44, y: -92, width: 80, height: 64 }),
    componentCount: 1,
  }),
  eyes: Object.freeze({
    sourceRect: Object.freeze({ x: 836, y: 292, width: 172, height: 84 }),
    bindRect: Object.freeze({ x: -3, y: -53, width: 43, height: 21 }),
    componentCount: 2,
  }),
  mouth: Object.freeze({
    sourceRect: Object.freeze({ x: 836, y: 384, width: 64, height: 60 }),
    bindRect: Object.freeze({ x: 13, y: -39, width: 16, height: 15 }),
    componentCount: 1,
  }),
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function rectsOverlap(left, right) {
  return (
    left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height
  );
}

function alphaComponents4(image, threshold = 32) {
  const seen = new Uint8Array(image.width * image.height);
  const minimumArea = Math.max(20, Math.floor(image.width * image.height / 250));
  const components = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || image.pixels[start * 4 + 3] < threshold) continue;
    const queue = [start];
    seen[start] = 1;
    let area = 0;
    let left = image.width;
    let top = image.height;
    let right = -1;
    let bottom = -1;
    while (queue.length > 0) {
      const current = queue.pop();
      const x = current % image.width;
      const y = Math.floor(current / image.width);
      area += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (const [nextX, nextY] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
        const next = nextY * image.width + nextX;
        if (seen[next] || image.pixels[next * 4 + 3] < threshold) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    if (area >= minimumArea) {
      components.push({
        area,
        bounds: {
          x: left,
          y: top,
          width: right - left + 1,
          height: bottom - top + 1,
        },
      });
    }
  }
  return components.sort((left, right) => right.area - left.area);
}

function visiblePixelCount(image) {
  let count = 0;
  for (let offset = 3; offset < image.pixels.length; offset += 4) {
    if (image.pixels[offset] > 0) count += 1;
  }
  return count;
}

function assertTransparentPerimeter(image, label) {
  for (let x = 0; x < image.width; x += 1) {
    assert.equal(image.pixels[x * 4 + 3], 0, `${label} top edge needs alpha padding`);
    const bottom = ((image.height - 1) * image.width + x) * 4 + 3;
    assert.equal(image.pixels[bottom], 0, `${label} bottom edge needs alpha padding`);
  }
  for (let y = 0; y < image.height; y += 1) {
    assert.equal(image.pixels[y * image.width * 4 + 3], 0, `${label} left edge needs alpha padding`);
    const right = (y * image.width + image.width - 1) * 4 + 3;
    assert.equal(image.pixels[right], 0, `${label} right edge needs alpha padding`);
  }
}

test('Shell layered v3 atlas rebuilds byte-for-byte from its guarded generated master', async () => {
  const [source, beforeAtlas, beforeReportText, scriptSource] = await Promise.all([
    readFile(SOURCE_URL),
    readFile(ATLAS_URL),
    readFile(REPORT_URL, 'utf8'),
    readFile(SCRIPT_URL, 'utf8'),
  ]);
  const beforeReport = JSON.parse(beforeReportText);
  const sourceHash = sha256(source);

  assert.equal(beforeReport.source.sha256, sourceHash);
  assert.match(
    scriptSource,
    new RegExp(`SOURCE_SHA256\\s*=\\s*["']${sourceHash}["']`),
    'the builder must refuse a silently replaced generated layer master',
  );

  const rebuild = spawnSync('python3', [fileURLToPath(SCRIPT_URL)], {
    cwd: fileURLToPath(ROOT_URL),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  assert.equal(rebuild.status, 0, rebuild.stderr || rebuild.stdout);

  const [afterAtlas, afterReportText] = await Promise.all([
    readFile(ATLAS_URL),
    readFile(REPORT_URL, 'utf8'),
  ]);
  assert.deepEqual(afterAtlas, beforeAtlas);
  assert.equal(afterReportText, beforeReportText);

  const report = JSON.parse(afterReportText);
  assert.deepEqual(
    {
      ownerId: report.ownerId,
      sourceMode: report.source.mode,
      outputMode: report.output.mode,
      outputWidth: report.output.width,
      outputHeight: report.output.height,
    },
    {
      ownerId: OWNER,
      sourceMode: 'RGB',
      outputMode: 'RGBA',
      outputWidth: 1024,
      outputHeight: 768,
    },
  );
  assert.equal(report.output.sha256, sha256(afterAtlas));
  assert.match(report.matting.background, /checker removed deterministically/i);
  for (const [id, spec] of Object.entries(LAYOUT)) {
    assert.deepEqual(report.layers[id].sourceRect, spec.sourceRect);
    assert.equal(report.layers[id].componentAreas.length, spec.componentCount);
    assert.ok(report.layers[id].componentAreas.every((area) => area >= 4_000));
  }
});

test('Shell v3 cells are independent transparent cutouts without a baked checker', async () => {
  const atlas = decodeRgbaPng(await readFile(ATLAS_URL), 'Shell layered v3 atlas');
  assert.deepEqual({ width: atlas.width, height: atlas.height }, { width: 1024, height: 768 });

  const specs = Object.entries(LAYOUT);
  for (let index = 0; index < specs.length; index += 1) {
    const [id, spec] = specs[index];
    for (let otherIndex = index + 1; otherIndex < specs.length; otherIndex += 1) {
      assert.equal(
        rectsOverlap(spec.sourceRect, specs[otherIndex][1].sourceRect),
        false,
        `${id} and ${specs[otherIndex][0]} need independent atlas cells`,
      );
    }
  }

  let visibleAtlasPixels = 0;
  let neutralBrightPixels = 0;
  for (let y = 0; y < atlas.height; y += 1) {
    for (let x = 0; x < atlas.width; x += 1) {
      const offset = (y * atlas.width + x) * 4;
      const alpha = atlas.pixels[offset + 3];
      const target = specs.find(([, { sourceRect }]) => (
        x >= sourceRect.x
        && x < sourceRect.x + sourceRect.width
        && y >= sourceRect.y
        && y < sourceRect.y + sourceRect.height
      ));
      if (!target) {
        assert.equal(alpha, 0, `unexpected pixel outside layer cells at ${x},${y}`);
        continue;
      }
      if (alpha === 0) continue;
      visibleAtlasPixels += 1;
      const red = atlas.pixels[offset];
      const green = atlas.pixels[offset + 1];
      const blue = atlas.pixels[offset + 2];
      if (
        alpha >= 96
        && Math.max(red, green, blue) - Math.min(red, green, blue) < 8
        && Math.min(red, green, blue) > 230
      ) neutralBrightPixels += 1;
    }
  }
  assert.ok(visibleAtlasPixels > 100_000);
  assert.ok(
    neutralBrightPixels / visibleAtlasPixels < 0.15,
    'near-white checker pixels must not survive as an opaque background',
  );

  for (const [id, spec] of specs) {
    const cell = cropRgba(atlas, spec.sourceRect, `${id} cell`);
    const visible = visiblePixelCount(cell);
    assert.ok(visible > cell.width * cell.height * 0.08, `${id} must contain real art`);
    assert.ok(visible < cell.width * cell.height * 0.9, `${id} must retain transparency`);
    assertTransparentPerimeter(cell, id);
    assert.equal(
      alphaComponents4(cell).length,
      spec.componentCount,
      `${id} must contain ${spec.componentCount} substantial alpha component(s)`,
    );
  }

  const rearShell = cropRgba(atlas, LAYOUT.shellBack.sourceRect, 'shellBack cell');
  assert.equal(
    alphaComponents4(rearShell).length,
    1,
    'the rear shell must not include a second standalone harness or buckle component',
  );
});

test('Shell manifest binds the five v3 cells and keeps face expressions separate', () => {
  const rig = MANIFEST.rigs[OWNER];
  assert.deepEqual(rig.parts.map(({ id }) => id), Object.keys(LAYOUT));
  for (const part of rig.parts) {
    const expected = LAYOUT[part.id];
    assert.equal(part.path, ATLAS_PATH);
    assert.deepEqual(part.sourceRect, expected.sourceRect);
    assert.deepEqual(part.bindRect, expected.bindRect);
    assert.equal(part.bone, part.id);
  }

  for (const id of ['eyes', 'mouth']) {
    const variants = Object.values(rig.parts.find((part) => part.id === id).variants);
    assert.ok(variants.length > 0);
    assert.ok(variants.every(({ path }) => path === EXPRESSION_PATH));
  }
});
