import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG_PATH = fileURLToPath(
  new URL('../assets/config/hero-atlas-layouts.json', import.meta.url),
);
const REPACK_SCRIPT = fileURLToPath(
  new URL('../scripts/repack-creature-atlas.py', import.meta.url),
);
const SIDECAR_SCRIPT = fileURLToPath(
  new URL('../scripts/package-hero-expression-sidecar.py', import.meta.url),
);
const CELL = 418;
const ATLAS = CELL * 3;
const EXPRESSION_NAMES = Object.freeze([
  'normalEyes',
  'normalMouth',
  'attackEyes',
  'attackMouth',
  'hurtEyes',
  'hurtMouth',
]);
const HERO_IDS = Object.freeze([
  'hero-berry-burst-atlas-v1',
  'hero-dew-bloom-atlas-v1',
  'hero-bell-boom-atlas-v1',
  'hero-drill-gum-atlas-v1',
  'hero-ember-fizz-atlas-v1',
  'hero-ink-splash-atlas-v1',
  'hero-cloud-spin-atlas-v1',
  'hero-frost-drop-atlas-v1',
  'hero-honey-pop-atlas-v1',
  'hero-spark-bean-atlas-v1',
  'hero-star-core-atlas-v1',
]);
const FOREGROUND_HEADGEAR = new Set([
  'hero-berry-burst-atlas-v1',
  'hero-bell-boom-atlas-v1',
  'hero-drill-gum-atlas-v1',
  'hero-ember-fizz-atlas-v1',
  'hero-ink-splash-atlas-v1',
  'hero-cloud-spin-atlas-v1',
  'hero-frost-drop-atlas-v1',
  'hero-honey-pop-atlas-v1',
  'hero-spark-bean-atlas-v1',
]);

const SIDECAR_FIXTURE_SCRIPT = String.raw`
from pathlib import Path
import sys
from PIL import Image, ImageDraw

canonical_path, source_path = map(Path, sys.argv[1:])
canonical = Image.new("RGBA", (1254, 1254), (0, 0, 0, 0))
draw = ImageDraw.Draw(canonical)
# Exact local bboxes: eyes=(118,140,300,214), mouth=(184,270,234,290).
draw.rectangle((118, 418 + 140, 299, 418 + 213), fill=(20, 45, 78, 255))
draw.rectangle((418 + 184, 418 + 270, 418 + 233, 418 + 289), fill=(20, 45, 78, 255))
canonical.save(canonical_path, format="PNG", optimize=True)

source = Image.new("RGBA", (600, 300), (0, 0, 0, 0))
draw = ImageDraw.Draw(source)
draw.ellipse((90, 100, 209, 179), fill=(30, 65, 105, 255))
draw.rounded_rectangle((300 + 125, 130, 300 + 174, 159), radius=10, fill=(30, 65, 105, 255))
source.save(source_path, format="PNG", optimize=True)
`;

function alphaBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0
    ? null
    : { left, top, right: right + 1, bottom: bottom + 1 };
}

function boundsCenter(bounds) {
  assert.ok(bounds, 'expected visible alpha bounds');
  return [
    (bounds.left + bounds.right) / 2,
    (bounds.top + bounds.bottom) / 2,
  ];
}

function assertTwoPixelGutter(cell, label) {
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      if (x >= 2 && x < CELL - 2 && y >= 2 && y < CELL - 2) continue;
      assert.equal(
        cell.pixels[(y * CELL + x) * 4 + 3],
        0,
        `${label} must retain a 2px transparent gutter`,
      );
    }
  }
}

async function readConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
}

test('hero layout bundle is complete and records the intended render order', async () => {
  const config = await readConfig();
  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(Object.keys(config.layouts), HERO_IDS);

  for (const id of HERO_IDS) {
    const layout = config.layouts[id];
    assert.equal(layout.gutter, 2, `${id} gutter`);
    assert.equal(layout.allowUpscale, false, `${id} global upscale`);
    assert.deepEqual(Object.keys(layout.physical), ['body', 'headgear', 'equipment']);
    assert.equal(layout.physical.body.z, 0, `${id} body z`);
    assert.equal(
      layout.physical.headgear.z,
      FOREGROUND_HEADGEAR.has(id) ? 10 : -5,
      `${id} headgear z`,
    );
    assert.equal(layout.physical.equipment.z, 40, `${id} weapon/equipment z`);
    for (const [name, physical] of Object.entries(layout.physical)) {
      assert.equal(physical.group, 'nearest', `${id} ${name} group`);
      assert.equal(physical.allowUpscale, false, `${id} ${name} upscale`);
      assert.equal(physical.center.length, 2, `${id} ${name} center`);
      assert.equal(physical.maxSize.length, 2, `${id} ${name} maxSize`);
    }

    assert.deepEqual(Object.keys(layout.expressions.maxSize), EXPRESSION_NAMES);
    for (const name of EXPRESSION_NAMES) {
      const expression = layout.expressions.maxSize[name];
      assert.equal(expression.center.length, 2, `${id} ${name} center`);
      assert.equal(expression.maxSize.length, 2, `${id} ${name} maxSize`);
      assert.equal(expression.allowUpscale, false, `${id} ${name} upscale`);
    }
    assert.equal(layout.skillFace.eyesScale, 1, `${id} skill eyes scale`);
    assert.ok(
      layout.skillFace.mouthScale >= 1 && layout.skillFace.mouthScale <= 2,
      `${id} skill mouth readability scale`,
    );
  }
});

test('every bundled hero layout is directly consumable and produces nine gutter-safe cells', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hero-layouts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = await readConfig();

  for (const id of HERO_IDS) {
    const layout = config.layouts[id];
    const input = path.join(ROOT, layout.assetPath);
    const output = path.join(directory, `${id}.png`);
    const stdout = execFileSync(
      'python3',
      [
        REPACK_SCRIPT,
        input,
        output,
        '--layout',
        CONFIG_PATH,
        '--layout-id',
        id,
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    const report = JSON.parse(stdout);
    assert.deepEqual(
      report.layers.map((layer) => layer.name),
      ['body', 'headgear', 'equipment', ...EXPRESSION_NAMES],
      `${id} slot order`,
    );
    for (const layer of report.layers) {
      const expected = layer.kind === 'physical'
        ? layout.physical[layer.name]
        : layout.expressions.maxSize[layer.name];
      assert.deepEqual(layer.target.center, expected.center, `${id} ${layer.name} center`);
      assert.deepEqual(layer.target.maxSize, expected.maxSize, `${id} ${layer.name} maxSize`);
    }

    const image = decodeRgbaPng(await readFile(output), id);
    assert.deepEqual([image.width, image.height], [ATLAS, ATLAS]);
    for (let slot = 0; slot < 9; slot += 1) {
      const cell = cropRgba(
        image,
        {
          x: (slot % 3) * CELL,
          y: Math.floor(slot / 3) * CELL,
          width: CELL,
          height: CELL,
        },
        `${id} cell ${slot}`,
      );
      assert.ok(alphaBounds(cell), `${id} cell ${slot} must not be empty`);
      assertTwoPixelGutter(cell, `${id} cell ${slot}`);
    }
  }
});

test('skill sidecar packaging is deterministic, center-exact, and applies per-hero readability scale', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hero-sidecar-layout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const canonicalPath = path.join(directory, 'canonical.png');
  const sourcePath = path.join(directory, 'source.png');
  const defaultPath = path.join(directory, 'default.png');
  const configuredPath = path.join(directory, 'configured.png');
  const repeatedPath = path.join(directory, 'configured-again.png');
  execFileSync(
    'python3',
    ['-c', SIDECAR_FIXTURE_SCRIPT, canonicalPath, sourcePath],
    { cwd: ROOT },
  );

  execFileSync(
    'python3',
    [SIDECAR_SCRIPT, sourcePath, canonicalPath, defaultPath],
    { cwd: ROOT },
  );
  const configuredArguments = [
    SIDECAR_SCRIPT,
    sourcePath,
    canonicalPath,
    configuredPath,
    '--layout',
    CONFIG_PATH,
    '--layout-id',
    'hero-bell-boom-atlas-v1',
  ];
  execFileSync('python3', configuredArguments, { cwd: ROOT });
  configuredArguments[3] = repeatedPath;
  execFileSync('python3', configuredArguments, { cwd: ROOT });
  assert.deepEqual(
    await readFile(configuredPath),
    await readFile(repeatedPath),
    'same inputs and layout must produce byte-identical PNGs',
  );

  const canonical = decodeRgbaPng(await readFile(canonicalPath), 'canonical');
  const configured = decodeRgbaPng(await readFile(configuredPath), 'configured');
  const defaultSidecar = decodeRgbaPng(await readFile(defaultPath), 'default');
  const canonicalEyes = cropRgba(
    canonical,
    { x: 0, y: CELL, width: CELL, height: CELL },
    'canonical eyes',
  );
  const canonicalMouth = cropRgba(
    canonical,
    { x: CELL, y: CELL, width: CELL, height: CELL },
    'canonical mouth',
  );
  const configuredEyes = cropRgba(
    configured,
    { x: 0, y: 0, width: CELL, height: CELL },
    'configured eyes',
  );
  const configuredMouth = cropRgba(
    configured,
    { x: CELL, y: 0, width: CELL, height: CELL },
    'configured mouth',
  );
  const defaultMouth = cropRgba(
    defaultSidecar,
    { x: CELL, y: 0, width: CELL, height: CELL },
    'default mouth',
  );

  const canonicalEyesBounds = alphaBounds(canonicalEyes);
  const canonicalMouthBounds = alphaBounds(canonicalMouth);
  const configuredEyesBounds = alphaBounds(configuredEyes);
  const configuredMouthBounds = alphaBounds(configuredMouth);
  const defaultMouthBounds = alphaBounds(defaultMouth);
  assert.deepEqual(
    boundsCenter(configuredEyesBounds),
    boundsCenter(canonicalEyesBounds),
    'skill eyes center must exactly match normal eyes center',
  );
  assert.deepEqual(
    boundsCenter(configuredMouthBounds),
    boundsCenter(canonicalMouthBounds),
    'skill mouth center must exactly match normal mouth center',
  );
  assert.ok(
    configuredMouthBounds.bottom - configuredMouthBounds.top
      > defaultMouthBounds.bottom - defaultMouthBounds.top,
    'bell-boom mouthScale must visibly improve skill-mouth readability',
  );
  assert.ok(
    configuredMouthBounds.right - configuredMouthBounds.left
      <= Math.floor((canonicalMouthBounds.right - canonicalMouthBounds.left) * 1.08 * 1.35),
    'configured mouth must stay within its calibrated maximum width',
  );
  assert.ok(
    configuredMouthBounds.bottom - configuredMouthBounds.top
      <= Math.floor((canonicalMouthBounds.bottom - canonicalMouthBounds.top) * 1.08 * 1.35),
    'configured mouth must stay within its calibrated maximum height',
  );
  assertTwoPixelGutter(configuredEyes, 'configured skill eyes');
  assertTwoPixelGutter(configuredMouth, 'configured skill mouth');
});
