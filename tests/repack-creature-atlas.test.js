import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = fileURLToPath(
  new URL('../scripts/repack-creature-atlas.py', import.meta.url),
);
const CELL = 418;
const ATLAS = CELL * 3;
const FORMAL_LAYOUT_DIRECTORY = fileURLToPath(
  new URL('../assets/config/creature-atlas/', import.meta.url),
);
const FORMAL_LAYOUTS = [
  'enemy-lantern-spore-atlas-v1.json',
  'enemy-mud-bulwark-atlas-v1.json',
  'enemy-rift-beacon-king-atlas-v1.json',
  'enemy-thorn-roller-atlas-v1.json',
  'soldier-bean-bow-atlas-v1.json',
  'soldier-bounce-hammer-atlas-v1.json',
  'soldier-drill-lancer-atlas-v1.json',
  'soldier-leaf-spinner-atlas-v1.json',
  'soldier-shield-dun-atlas-v1.json',
  'soldier-spore-lobber-atlas-v1.json',
  'soldier-volt-orbiter-atlas-v1.json',
];
const PHYSICAL_ROLES = ['body', 'equipment', 'headgear'];
const EXPRESSION_ROLES = [
  'normalEyes',
  'normalMouth',
  'attackEyes',
  'attackMouth',
  'hurtEyes',
  'hurtMouth',
];
const FIXTURE_SCRIPT = String.raw`
from pathlib import Path
import sys
from PIL import Image, ImageDraw

output = Path(sys.argv[1])
image = Image.new("RGBA", (1254, 1254), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

# Every physical object deliberately crosses an original 418px boundary.
draw.rounded_rectangle((60, 120, 450, 370), radius=96, fill=(30, 210, 110, 255))
draw.ellipse((530, 330, 760, 455), fill=(145, 80, 235, 255))
# Simulate an image generator baking a fully opaque grey/white checkerboard
# into a ring opening.  It remains alpha-connected to the purple headgear.
for y in range(354, 431):
    for x in range(603, 688):
        if ((x - 645) / 42) ** 2 + ((y - 392) / 38) ** 2 <= 1:
            shade = 238 if ((x // 9) + (y // 9)) % 2 else 248
            draw.point((x, y), fill=(shade, shade, shade, 255))
# A real white highlight is also near-neutral, but separated from the checker
# by purple pixels.  Seeded flood clearing must preserve it.
draw.ellipse((550, 340, 580, 360), fill=(255, 255, 255, 255))
# Detached crown point: same physical layer and colour, but no alpha connection
# to the main headgear. Nearest grouping must retain it as a second component.
draw.ellipse((490, 350, 520, 390), fill=(145, 80, 235, 255))
draw.polygon(((800, 95), (990, 45), (1100, 175), (825, 285)), fill=(255, 155, 30, 255))

expression_shapes = {
    3: ("eyes", 130, 135, 34, 48),
    4: ("mouth", 285, 205, 52, 24),
    5: ("eyes", 275, 190, 46, 38),
    6: ("mouth", 120, 115, 66, 30),
    7: ("eyes", 165, 265, 30, 54),
    8: ("mouth", 295, 285, 42, 28),
}
for slot, (kind, center_x, center_y, width, height) in expression_shapes.items():
    cell_x = slot % 3 * 418
    cell_y = slot // 3 * 418
    if kind == "eyes":
        gap = 24
        for offset in (-gap, gap):
            left = cell_x + center_x + offset - width // 2
            top = cell_y + center_y - height // 2
            draw.ellipse((left, top, left + width, top + height), fill=(20, 50, 85, 255))
    else:
        left = cell_x + center_x - width // 2
        top = cell_y + center_y - height // 2
        draw.rounded_rectangle(
            (left, top, left + width, top + height),
            radius=max(3, height // 3),
            fill=(20, 50, 85, 255),
        )

    # A vivid contaminant crosses the bottom of every authored expression cell.
    # It must be removed, not clipped and scaled together with the expression.
    draw.rectangle(
        (cell_x + 335, cell_y + 398, cell_x + 360, cell_y + 430),
        fill=(255, 0, 60, 255),
    )

image.save(output, format="PNG", optimize=True)
`;

const JSON_LAYOUT = Object.freeze({
  gutter: 2,
  alphaThreshold: 16,
  allowUpscale: true,
  physical: {
    body: {
      sourceCenter: [255, 245],
      sourceRadius: 165,
      center: [209, 265],
      maxSize: [390, 250],
      z: 0,
    },
    headgear: {
      sourceCenter: [645, 392],
      // Deliberately reaches a face component in row 1. The physical-row gate
      // must still keep that expression out of the headgear group.
      sourceRadius: 300,
      center: [209, 104],
      maxSize: [230, 125],
      z: -5,
    },
    equipment: {
      sourceCenter: [910, 175],
      sourceRadius: 210,
      center: [280, 250],
      maxSize: [250, 200],
      z: 40,
    },
  },
  expressions: {
    eyesCenter: [209, 175],
    mouthCenter: [209, 265],
    boundaryMargin: 2,
    minimumComponentArea: 4,
    z: { eyes: 30, mouth: 31 },
    maxSize: {
      normalEyes: [110, 50],
      normalMouth: {
        maxSize: [52, 24],
        center: [209, 258],
        allowUpscale: true,
      },
      attackEyes: {
        maxSize: [140, 60],
        center: [209, 162],
        allowUpscale: false,
      },
      attackMouth: {
        maxSize: [70, 32],
        center: [213, 270],
        allowUpscale: true,
      },
      hurtEyes: {
        maxSize: [92, 54],
        center: [209, 188],
        allowUpscale: true,
      },
      hurtMouth: {
        maxSize: [60, 40],
        center: [205, 280],
        allowUpscale: false,
      },
    },
  },
});

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

function assertTwoPixelGutter(cell, label) {
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      if (x >= 2 && x < CELL - 2 && y >= 2 && y < CELL - 2) continue;
      assert.equal(
        cell.pixels[(y * CELL + x) * 4 + 3],
        0,
        `${label} must keep a 2px transparent gutter`,
      );
    }
  }
}

function countVisibleColor(image, red, green, blue) {
  let count = 0;
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    if (
      image.pixels[offset] === red
      && image.pixels[offset + 1] === green
      && image.pixels[offset + 2] === blue
      && image.pixels[offset + 3] > 0
    ) count += 1;
  }
  return count;
}

function countOpaqueNearNeutral(image, minimumValue = 220, maximumChroma = 8) {
  let count = 0;
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    const alpha = image.pixels[offset + 3];
    if (
      alpha >= 16
      && Math.min(red, green, blue) >= minimumValue
      && Math.max(red, green, blue) - Math.min(red, green, blue) <= maximumChroma
    ) count += 1;
  }
  return count;
}

function alphaComponentAreas(image, threshold = 32) {
  const seen = new Uint8Array(image.width * image.height);
  const areas = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || image.pixels[start * 4 + 3] < threshold) continue;
    const queue = [start];
    seen[start] = 1;
    let area = 0;
    while (queue.length > 0) {
      const current = queue.pop();
      const x = current % image.width;
      const y = Math.floor(current / image.width);
      area += 1;
      for (const [nextX, nextY] of [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ]) {
        if (nextX < 0 || nextY < 0 || nextX >= image.width || nextY >= image.height) continue;
        const next = nextY * image.width + nextX;
        if (seen[next] || image.pixels[next * 4 + 3] < threshold) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    areas.push(area);
  }
  return areas.sort((left, right) => right - left);
}

async function makeFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'creature-atlas-repack-'));
  const input = path.join(directory, 'input.png');
  const layout = path.join(directory, 'layout.json');
  execFileSync('python3', ['-c', FIXTURE_SCRIPT, input], { cwd: ROOT });
  await writeFile(layout, `${JSON.stringify(JSON_LAYOUT, null, 2)}\n`);
  return { directory, input, layout };
}

test('repacker registers all nine cells, removes boundary spill, and reports z only as metadata', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const output = path.join(fixture.directory, 'output.png');
  const secondOutput = path.join(fixture.directory, 'output-second.png');
  const reportPath = path.join(fixture.directory, 'report.json');

  const stdout = execFileSync(
    'python3',
    [SCRIPT, fixture.input, output, '--layout', fixture.layout, '--report', reportPath],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);
  assert.deepEqual(report, JSON.parse(await readFile(reportPath, 'utf8')));
  assert.equal(report.zMetadataOnly, true);
  assert.deepEqual(
    report.zOrder.slice(0, 3),
    [
      { name: 'headgear', z: -5 },
      { name: 'body', z: 0 },
      { name: 'normalEyes', z: 30 },
    ],
  );

  const image = decodeRgbaPng(await readFile(output), 'normalized test atlas');
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
      `slot ${slot}`,
    );
    assertTwoPixelGutter(cell, `slot ${slot}`);
    const bounds = alphaBounds(cell);
    assert.ok(bounds, `slot ${slot} must remain visible`);
    const layer = report.layers.find((entry) => entry.slot === slot);
    const actualCenter = [
      (bounds.left + bounds.right) / 2,
      (bounds.top + bounds.bottom) / 2,
    ];
    assert.ok(Math.abs(actualCenter[0] - layer.target.center[0]) <= 0.5);
    assert.ok(Math.abs(actualCenter[1] - layer.target.center[1]) <= 0.5);
    assert.ok(bounds.right - bounds.left <= layer.target.maxSize[0]);
    assert.ok(bounds.bottom - bounds.top <= layer.target.maxSize[1]);
  }

  const [body, headgear, equipment] = report.layers;
  assert.ok(body.source.crossedGridBoundaries.includes('x=418'));
  assert.ok(headgear.source.crossedGridBoundaries.includes('y=418'));
  assert.ok(equipment.source.crossedGridBoundaries.includes('x=836'));
  assert.equal(headgear.source.groupMode, 'nearest');
  assert.equal(headgear.source.componentCount, 2);
  assert.equal(headgear.source.componentAreas.filter((area) => area > 500).length, 2);
  const headgearCell = cropRgba(image, {
    x: CELL,
    y: 0,
    width: CELL,
    height: CELL,
  }, 'headgear output');
  assert.equal(
    alphaComponentAreas(headgearCell).filter((area) => area > 250).length,
    2,
    'both detached headgear pieces must survive grouping and resize',
  );
  const attackEyes = report.layers.find((entry) => entry.name === 'attackEyes');
  assert.deepEqual(attackEyes.target.center, [209, 162]);
  assert.equal(attackEyes.target.allowUpscale, false);
  assert.ok(
    attackEyes.target.visibleBounds[2] - attackEyes.target.visibleBounds[0] < 140,
    'per-expression allowUpscale=false should retain the smaller source size',
  );
  assert.deepEqual(
    report.layers.find((entry) => entry.name === 'hurtMouth').target.center,
    [205, 280],
  );
  for (const expression of report.layers.slice(3)) {
    assert.ok(
      expression.source.removedBoundaryComponentCount >= 1,
      `${expression.name} should report removed spill`,
    );
  }
  assert.equal(countVisibleColor(image, 255, 0, 60), 0, 'red boundary spill leaked');
  assert.ok(countVisibleColor(image, 30, 210, 110) > 10_000, 'body was not preserved');
  assert.ok(countVisibleColor(image, 145, 80, 235) > 5_000, 'headgear was not preserved');
  assert.ok(countVisibleColor(image, 255, 155, 30) > 5_000, 'equipment was not preserved');

  const secondStdout = execFileSync(
    'python3',
    [SCRIPT, fixture.input, secondOutput, '--layout', fixture.layout],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  assert.deepEqual(await readFile(secondOutput), await readFile(output));
  assert.deepEqual(JSON.parse(secondStdout), report);
});

test('complete CLI layout produces the same atlas as JSON layout', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const jsonOutput = path.join(fixture.directory, 'json.png');
  const cliOutput = path.join(fixture.directory, 'cli.png');
  const jsonReport = JSON.parse(execFileSync(
    'python3',
    [SCRIPT, fixture.input, jsonOutput, '--layout', fixture.layout],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  ));
  const cliArgs = [
    SCRIPT,
    fixture.input,
    cliOutput,
    '--physical', 'equipment,910,175,280,250,250,200,40,210',
    '--physical', 'body,255,245,209,265,390,250,0,165',
    '--physical', 'headgear,645,392,209,104,230,125,-5,300',
    '--eyes-center', '209,175',
    '--mouth-center', '209,265',
    '--eyes-z', '30',
    '--mouth-z', '31',
  ];
  for (const [name, entry] of Object.entries(JSON_LAYOUT.expressions.maxSize)) {
    if (Array.isArray(entry)) {
      cliArgs.push('--expression', `${name},${entry[0]},${entry[1]}`);
    } else {
      cliArgs.push(
        '--expression',
        [
          name,
          ...entry.maxSize,
          ...entry.center,
          String(entry.allowUpscale),
        ].join(','),
      );
    }
  }
  const cliReport = JSON.parse(execFileSync(
    'python3',
    cliArgs,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  ));
  assert.deepEqual(await readFile(cliOutput), await readFile(jsonOutput));
  assert.equal(cliReport.output.sha256, jsonReport.output.sha256);
  assert.deepEqual(cliReport.layers, jsonReport.layers);
});

test('explicit seed grouping selects every named detached physical fragment and nothing else', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const seededLayout = JSON.parse(JSON.stringify(JSON_LAYOUT));
  seededLayout.physical.headgear.group = {
    mode: 'seeds',
    seeds: [[645, 392], [505, 370]],
    seedRadius: 32,
    minimumComponentArea: 4,
  };
  const layoutPath = path.join(fixture.directory, 'seeded-layout.json');
  const output = path.join(fixture.directory, 'seeded.png');
  await writeFile(layoutPath, `${JSON.stringify(seededLayout, null, 2)}\n`);
  const report = JSON.parse(execFileSync(
    'python3',
    [SCRIPT, fixture.input, output, '--layout', layoutPath],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  ));
  const headgear = report.layers.find((entry) => entry.name === 'headgear');
  assert.equal(headgear.source.groupMode, 'seeds');
  assert.deepEqual(headgear.source.seeds, [[645, 392], [505, 370]]);
  assert.equal(headgear.source.componentCount, 2);
  const image = decodeRgbaPng(await readFile(output), 'seed-grouped atlas');
  const headgearCell = cropRgba(image, {
    x: CELL,
    y: 0,
    width: CELL,
    height: CELL,
  }, 'seed-grouped headgear');
  assert.equal(alphaComponentAreas(headgearCell).filter((area) => area > 250).length, 2);
  assert.equal(countVisibleColor(image, 255, 0, 60), 0, 'expression spill joined a seed group');
});

test('neutral clearFlood removes only the seeded enclosed checker and preserves white art', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const sourceBefore = await readFile(fixture.input);
  const unclearedOutput = path.join(fixture.directory, 'uncleared.png');
  const clearedOutput = path.join(fixture.directory, 'cleared.png');
  const unsafeOutput = path.join(fixture.directory, 'unsafe.png');
  execFileSync(
    'python3',
    [SCRIPT, fixture.input, unclearedOutput, '--layout', fixture.layout],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );

  const clearedLayout = JSON.parse(JSON.stringify(JSON_LAYOUT));
  clearedLayout.physical.headgear.clearFlood = {
    seeds: [[645, 392]],
    sourceBounds: [598, 349, 693, 436],
    minimumValue: 220,
    maximumChroma: 4,
    minimumArea: 4_500,
    maximumArea: 5_500,
    allowAlreadyClear: true,
  };
  const clearedLayoutPath = path.join(fixture.directory, 'cleared-layout.json');
  await writeFile(clearedLayoutPath, `${JSON.stringify(clearedLayout, null, 2)}\n`);
  const report = JSON.parse(execFileSync(
    'python3',
    [SCRIPT, fixture.input, clearedOutput, '--layout', clearedLayoutPath],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  ));
  assert.deepEqual(await readFile(fixture.input), sourceBefore, 'source atlas is read-only');
  const cleanup = report.layers.find((entry) => entry.name === 'headgear').source.clearFlood;
  assert.equal(cleanup.enabled, true);
  assert.equal(cleanup.alreadyClear, false);
  assert.equal(cleanup.predicate.connectivity, 4);
  assert.equal(cleanup.regions.length, 1);
  assert.equal(cleanup.regions[0].alreadyClear, false);
  assert.ok(cleanup.clearedPixelCount >= 4_500 && cleanup.clearedPixelCount <= 5_500);
  assert.deepEqual(cleanup.regions[0].sourceBounds, [603, 354, 688, 431]);

  const unclearedAtlas = decodeRgbaPng(
    await readFile(unclearedOutput),
    'uncleared neutral fixture atlas',
  );
  const clearedAtlas = decodeRgbaPng(
    await readFile(clearedOutput),
    'cleared neutral fixture atlas',
  );
  const cellBox = { x: CELL, y: 0, width: CELL, height: CELL };
  const unclearedHeadgear = cropRgba(unclearedAtlas, cellBox, 'uncleared headgear');
  const clearedHeadgear = cropRgba(clearedAtlas, cellBox, 'cleared headgear');
  const unclearedNeutral = countOpaqueNearNeutral(unclearedHeadgear);
  const clearedNeutral = countOpaqueNearNeutral(clearedHeadgear);
  assert.ok(
    clearedNeutral < unclearedNeutral / 4,
    'seeded checker pixels must become transparent',
  );
  assert.ok(clearedNeutral > 25, 'the disconnected white highlight must survive');

  const unsafeLayout = JSON.parse(JSON.stringify(clearedLayout));
  unsafeLayout.physical.headgear.clearFlood = {
    ...unsafeLayout.physical.headgear.clearFlood,
    seeds: [[565, 350]],
    sourceBounds: [545, 335, 585, 365],
  };
  const unsafeLayoutPath = path.join(fixture.directory, 'unsafe-layout.json');
  await writeFile(unsafeLayoutPath, `${JSON.stringify(unsafeLayout, null, 2)}\n`);
  const unsafe = spawnSync(
    'python3',
    [SCRIPT, fixture.input, unsafeOutput, '--layout', unsafeLayoutPath],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /clearFlood seed 0 selected \d+ pixels; expected/i);
  await assert.rejects(readFile(unsafeOutput), /ENOENT/);
});

test('volt-orbiter clearFlood is an explicit idempotent no-op on its cleared ring', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'volt-ring-clear-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const layoutPath = path.join(
    FORMAL_LAYOUT_DIRECTORY,
    'soldier-volt-orbiter-atlas-v1.json',
  );
  const layout = JSON.parse(await readFile(layoutPath, 'utf8'));
  const output = path.join(directory, 'volt.png');
  const report = JSON.parse(execFileSync(
    'python3',
    [SCRIPT, path.resolve(ROOT, layout.sourcePath), output, '--layout', layoutPath],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  ));
  const cleanup = report.layers.find((entry) => entry.name === 'headgear').source.clearFlood;
  assert.equal(cleanup.allowAlreadyClear, true);
  assert.equal(cleanup.alreadyClear, true);
  assert.equal(cleanup.clearedPixelCount, 0);
  assert.equal(cleanup.regions[0].alreadyClear, true);
  assert.equal(cleanup.regions[0].sourceBounds, null);

  const atlas = decodeRgbaPng(await readFile(output), 'cleared volt atlas');
  const pixel = (x, y) => {
    const offset = (y * atlas.width + x) * 4;
    return [...atlas.pixels.slice(offset, offset + 4)];
  };
  assert.equal(pixel(CELL + 209, 235)[3], 0, 'registered ring center must be transparent');
  const retainedHighlight = pixel(CELL + 238, 112);
  assert.ok(
    Math.min(...retainedHighlight.slice(0, 3)) >= 245 && retainedHighlight[3] === 255,
    'the ring white highlight must remain opaque',
  );

  const strictLayout = JSON.parse(JSON.stringify(layout));
  delete strictLayout.physical.headgear.clearFlood.allowAlreadyClear;
  const strictLayoutPath = path.join(directory, 'strict-layout.json');
  const strictOutput = path.join(directory, 'strict.png');
  await writeFile(strictLayoutPath, `${JSON.stringify(strictLayout, null, 2)}\n`);
  const strict = spawnSync(
    'python3',
    [SCRIPT, path.resolve(ROOT, layout.sourcePath), strictOutput, '--layout', strictLayoutPath],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.notEqual(strict.status, 0);
  assert.match(strict.stderr, /seed 0 is already transparent.*allowAlreadyClear=true/i);
  await assert.rejects(readFile(strictOutput), /ENOENT/);
});

test('invalid or incomplete layouts fail without writing a partial atlas', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const output = path.join(fixture.directory, 'must-not-exist.png');
  const failure = spawnSync(
    'python3',
    [
      SCRIPT,
      fixture.input,
      output,
      '--physical', 'body,255,245,209,265,390,250',
      '--eyes-center', '209,175',
      '--mouth-center', '209,265',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /exactly three --physical/i);
  await assert.rejects(readFile(output), /ENOENT/);
});

test('formal soldier and enemy layouts are complete read-only repacker inputs', async () => {
  const availableLayouts = (await readdir(FORMAL_LAYOUT_DIRECTORY))
    .filter((name) => name.endsWith('.json'));
  assert.deepEqual(
    FORMAL_LAYOUTS.filter((name) => !availableLayouts.includes(name)),
    [],
    'all seven soldier and four enemy layouts must be present',
  );

  const assertPair = (value, label) => {
    assert.ok(Array.isArray(value), `${label} must be an array`);
    assert.equal(value.length, 2, `${label} must have two values`);
    for (const component of value) {
      assert.equal(Number.isFinite(component), true, `${label} must be finite`);
    }
  };
  const assertTargetFitsCell = (entry, label, gutter) => {
    assertPair(entry.center, `${label}.center`);
    assertPair(entry.maxSize, `${label}.maxSize`);
    assert.ok(entry.maxSize[0] > 0 && entry.maxSize[1] > 0, `${label} has an empty size`);
    assert.ok(entry.center[0] - entry.maxSize[0] / 2 >= gutter, `${label} crosses left gutter`);
    assert.ok(entry.center[1] - entry.maxSize[1] / 2 >= gutter, `${label} crosses top gutter`);
    assert.ok(entry.center[0] + entry.maxSize[0] / 2 <= CELL - gutter, `${label} crosses right gutter`);
    assert.ok(entry.center[1] + entry.maxSize[1] / 2 <= CELL - gutter, `${label} crosses bottom gutter`);
  };

  for (const filename of FORMAL_LAYOUTS) {
    const layoutPath = path.join(FORMAL_LAYOUT_DIRECTORY, filename);
    const layout = JSON.parse(await readFile(layoutPath, 'utf8'));
    const expectedId = filename.slice(0, -'.json'.length);
    assert.equal(layout.schemaVersion, 1, `${filename} schema version`);
    assert.equal(layout.assetId, expectedId, `${filename} asset id`);
    assert.equal(layout.gutter, 2, `${filename} gutter`);
    assert.equal(layout.alphaThreshold, 16, `${filename} alpha threshold`);
    assert.equal(layout.physicalMinimumComponentArea, 16, `${filename} component threshold`);
    assert.equal(typeof layout.sourcePath, 'string', `${filename} source path`);

    const source = decodeRgbaPng(
      await readFile(path.resolve(ROOT, layout.sourcePath)),
      `${filename} source atlas`,
    );
    assert.equal(source.width, ATLAS, `${filename} source width`);
    assert.equal(source.height, ATLAS, `${filename} source height`);

    const slotNames = [
      'body',
      'headgear',
      'equipment',
      ...EXPRESSION_ROLES,
    ];
    for (const [slot, role] of slotNames.entries()) {
      const cell = cropRgba(source, {
        x: (slot % 3) * CELL,
        y: Math.floor(slot / 3) * CELL,
        width: CELL,
        height: CELL,
      }, `${filename} ${role}`);
      const bounds = alphaBounds(cell);
      assert.ok(bounds, `${filename} ${role} must be visible`);
      assertTwoPixelGutter(cell, `${filename} ${role}`);
      const target = slot < 3
        ? layout.physical[role]
        : layout.expressions.maxSize[role];
      const center = [
        (bounds.left + bounds.right) / 2,
        (bounds.top + bounds.bottom) / 2,
      ];
      assert.ok(
        Math.abs(center[0] - target.center[0]) <= 0.5
          && Math.abs(center[1] - target.center[1]) <= 0.5,
        `${filename} ${role} center ${JSON.stringify(center)} must match `
          + `${JSON.stringify(target.center)}`,
      );
      assert.ok(
        bounds.right - bounds.left <= target.maxSize[0]
          && bounds.bottom - bounds.top <= target.maxSize[1],
        `${filename} ${role} exceeds its calibrated maximum size`,
      );
    }

    assert.deepEqual(Object.keys(layout.physical).sort(), PHYSICAL_ROLES);
    for (const role of PHYSICAL_ROLES) {
      const entry = layout.physical[role];
      const label = `${filename}.physical.${role}`;
      assertPair(entry.sourceCenter, `${label}.sourceCenter`);
      assert.ok(entry.sourceRadius > 0, `${label}.sourceRadius must be positive`);
      assertTargetFitsCell(entry, label, layout.gutter);
      if (role === 'body') {
        assert.equal(entry.z, 0, `${label} must be the body plane`);
      } else if (role === 'equipment') {
        assert.ok([-5, 40].includes(entry.z), `${label} must be explicitly rear or foreground`);
      } else {
        assert.ok([-5, 10].includes(entry.z), `${label} must be explicitly rear or upper-body`);
      }
      if (typeof entry.group === 'string') {
        assert.equal(entry.group, 'nearest', `${label}.group`);
      } else {
        assert.equal(entry.group.mode, 'seeds', `${label}.group.mode`);
        assert.ok(entry.group.seeds.length >= 2, `${label} must preserve detached pieces`);
        for (const [index, seed] of entry.group.seeds.entries()) {
          assertPair(seed, `${label}.group.seeds[${index}]`);
        }
        assert.ok(entry.group.seedRadius > 0, `${label}.group.seedRadius`);
      }
      if (entry.clearFlood !== undefined) {
        assert.equal(
          `${layout.assetId}:${role}`,
          'soldier-volt-orbiter-atlas-v1:headgear',
          `${label} is not approved for destructive neutral cleanup`,
        );
      }
    }

    const expressions = layout.expressions;
    assertPair(expressions.eyesCenter, `${filename}.expressions.eyesCenter`);
    assertPair(expressions.mouthCenter, `${filename}.expressions.mouthCenter`);
    assert.equal(expressions.allowUpscale, false, `${filename} expression default upscale`);
    assert.equal(expressions.boundaryMargin, 2, `${filename} expression cleanup margin`);
    assert.equal(expressions.minimumComponentArea, 4, `${filename} expression component threshold`);
    assert.deepEqual(expressions.z, { eyes: 30, mouth: 31 }, `${filename} expression z`);
    assert.deepEqual(Object.keys(expressions.maxSize).sort(), [...EXPRESSION_ROLES].sort());
    for (const role of EXPRESSION_ROLES) {
      const entry = expressions.maxSize[role];
      const label = `${filename}.expressions.maxSize.${role}`;
      assert.equal(Array.isArray(entry), false, `${label} must use the per-expression object form`);
      assert.equal(entry.allowUpscale, false, `${label}.allowUpscale`);
      assertTargetFitsCell(entry, label, layout.gutter);
    }

    for (const state of ['normal', 'attack', 'hurt']) {
      const eyes = expressions.maxSize[`${state}Eyes`];
      const mouth = expressions.maxSize[`${state}Mouth`];
      const eyesBottom = eyes.center[1] + eyes.maxSize[1] / 2;
      const mouthTop = mouth.center[1] - mouth.maxSize[1] / 2;
      assert.ok(eyesBottom <= mouthTop, `${filename} ${state} eyes overlap the mouth`);
    }
  }

  const rift = JSON.parse(await readFile(
    path.join(FORMAL_LAYOUT_DIRECTORY, 'enemy-rift-beacon-king-atlas-v1.json'),
    'utf8',
  ));
  assert.equal(rift.physical.headgear.group.mode, 'seeds');
  assert.equal(rift.physical.headgear.group.seeds.length, 5, 'rift crown-ring fragments');

  const volt = JSON.parse(await readFile(
    path.join(FORMAL_LAYOUT_DIRECTORY, 'soldier-volt-orbiter-atlas-v1.json'),
    'utf8',
  ));
  assert.deepEqual(volt.physical.headgear.clearFlood, {
    seeds: [[628, 230]],
    sourceBounds: [582, 182, 666, 283],
    minimumValue: 160,
    maximumChroma: 18,
    minimumArea: 5000,
    maximumArea: 7000,
    allowAlreadyClear: true,
  });

  const spore = JSON.parse(await readFile(
    path.join(FORMAL_LAYOUT_DIRECTORY, 'soldier-spore-lobber-atlas-v1.json'),
    'utf8',
  ));
  assert.deepEqual(spore.physical.equipment.center, [333, 318]);
  assert.deepEqual(spore.physical.equipment.maxSize, [165, 100]);
  assert.equal(spore.physical.equipment.z, -5);
});
