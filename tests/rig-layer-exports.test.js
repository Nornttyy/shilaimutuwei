import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  decodeRgbaPng,
  DEFAULT_OUTPUT_ROOT,
  exportRigLayers,
  PROJECT_ROOT,
} from '../scripts/export-rig-layers.mjs';

const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rectanglesOverlap(a, b) {
  return (
    Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width)
    && Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height)
  );
}

async function listRelativeFiles(root, directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listRelativeFiles(root, fullPath));
    else output.push(path.relative(root, fullPath));
  }
  return output.sort();
}

function crop(image, rect) {
  const pixels = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * image.width + rect.x) * 4;
    image.pixels.copy(
      pixels,
      y * rect.width * 4,
      sourceStart,
      sourceStart + rect.width * 4,
    );
  }
  return { width: rect.width, height: rect.height, pixels };
}

/**
 * Best-effort duplicate-face detector. It maps a face layer back into the
 * body's bind rectangle and counts near-identical visible RGB samples.
 * This catches a body with the same painted face while tolerating body color
 * underneath separately composited eyes and mouths.
 */
function placedFaceColorMatch(bodyPart, bodyImage, facePart, faceImage) {
  let compared = 0;
  let matching = 0;
  for (let faceY = 0; faceY < faceImage.height; faceY += 1) {
    for (let faceX = 0; faceX < faceImage.width; faceX += 1) {
      const faceOffset = (faceY * faceImage.width + faceX) * 4;
      if (faceImage.pixels[faceOffset + 3] < 64) continue;
      const rigX = facePart.bindRect.x
        + ((faceX + 0.5) / faceImage.width) * facePart.bindRect.width;
      const rigY = facePart.bindRect.y
        + ((faceY + 0.5) / faceImage.height) * facePart.bindRect.height;
      const bodyX = Math.floor(
        ((rigX - bodyPart.bindRect.x) / bodyPart.bindRect.width) * bodyImage.width,
      );
      const bodyY = Math.floor(
        ((rigY - bodyPart.bindRect.y) / bodyPart.bindRect.height) * bodyImage.height,
      );
      if (bodyX < 0 || bodyY < 0 || bodyX >= bodyImage.width || bodyY >= bodyImage.height) {
        continue;
      }
      const bodyOffset = (bodyY * bodyImage.width + bodyX) * 4;
      if (bodyImage.pixels[bodyOffset + 3] < 64) continue;
      compared += 1;
      const difference = Math.max(
        Math.abs(faceImage.pixels[faceOffset] - bodyImage.pixels[bodyOffset]),
        Math.abs(faceImage.pixels[faceOffset + 1] - bodyImage.pixels[bodyOffset + 1]),
        Math.abs(faceImage.pixels[faceOffset + 2] - bodyImage.pixels[bodyOffset + 2]),
      );
      if (difference <= 12) matching += 1;
    }
  }
  return { compared, ratio: compared === 0 ? 0 : matching / compared };
}

test('all current atlas sourceRects export to deterministic standalone RGBA PNGs', async (t) => {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'slime-rig-layers-'));
  const temporaryOutput = path.join(temporaryParent, 'rig-parts-exported');
  t.after(() => rm(temporaryParent, { recursive: true, force: true }));

  const report = await exportRigLayers({
    projectRoot: PROJECT_ROOT,
    outputRoot: temporaryOutput,
  });
  const rigs = Object.entries(report.rigs);
  const parts = rigs.flatMap(([, rig]) => rig.parts);
  const expressions = rigs.flatMap(([, rig]) => rig.expressions);
  assert.equal(rigs.length, 8);
  assert.equal(parts.length, 42);
  assert.equal(expressions.length, 56);

  const expectedFiles = [
    'index.json',
    ...parts.map(({ output }) => output),
    ...expressions.map(({ output }) => output),
  ].sort();
  assert.equal(expectedFiles.length, 99, '98 transparent PNGs plus index.json');
  assert.deepEqual(await listRelativeFiles(temporaryOutput), expectedFiles);
  assert.deepEqual(await listRelativeFiles(DEFAULT_OUTPUT_ROOT), expectedFiles);

  for (const layer of [...parts, ...expressions]) {
    await t.test(layer.output, async () => {
      const temporaryPng = await readFile(path.join(temporaryOutput, layer.output));
      const projectPng = await readFile(path.join(DEFAULT_OUTPUT_ROOT, layer.output));
      assert.deepEqual(projectPng, temporaryPng, 'checked-in export must be current');
      assert.equal(sha256(temporaryPng), layer.pngSha256);
      const decoded = decodeRgbaPng(temporaryPng, layer.output);
      assert.equal(decoded.width, layer.sourceRect.width);
      assert.equal(decoded.height, layer.sourceRect.height);
      assert.equal(decoded.width, layer.width);
      assert.equal(decoded.height, layer.height);
      assert.equal(sha256(decoded.pixels), layer.pixelSha256);
      assert.match(
        layer.sourcePath,
        /^assets\/generated-v2\/rig\/[^/]+\/(?:atlas(?:-layered-v2)?|expressions-v2)\.png$/,
      );
      assert.ok(layer.visiblePixels > 0, 'layer must contain visible alpha');
      assert.ok(layer.transparentPixels > 0, 'layer must retain a transparent background');
      assert.ok(layer.translucentPixels > 0, 'layer must retain anti-aliased alpha');
    });
  }

  assert.deepEqual(
    await readFile(path.join(DEFAULT_OUTPUT_ROOT, 'index.json')),
    await readFile(path.join(temporaryOutput, 'index.json')),
    'checked-in layer index must be reproducible',
  );
});

test('each character exposes seven real expression PNGs including normal', async (t) => {
  const index = JSON.parse(await readFile(path.join(DEFAULT_OUTPUT_ROOT, 'index.json'), 'utf8'));
  const expectedVariants = Object.freeze({
    eyes: ['normal', 'blink', 'hurt', 'attack'],
    mouth: ['normal', 'open', 'hurt'],
  });

  for (const [ownerId, rig] of Object.entries(index.rigs)) {
    await t.test(ownerId, async () => {
      assert.equal(rig.expressions.length, 7);
      for (const [partId, variants] of Object.entries(expectedVariants)) {
        const records = rig.expressions.filter((entry) => entry.partId === partId);
        assert.deepEqual(records.map(({ variant }) => variant), variants);
        assert.equal(
          new Set(records.map(({ pixelSha256 }) => pixelSha256)).size,
          variants.length,
          `${ownerId}.${partId} variants must contain different pixels`,
        );

        const base = rig.parts.find(({ id }) => id === partId);
        const normal = records.find(({ variant }) => variant === 'normal');
        assert.ok(base);
        assert.ok(normal);
        assert.equal(normal.sourcePath, base.sourcePath);
        assert.deepEqual(normal.sourceRect, base.sourceRect);
        assert.equal(normal.pixelSha256, base.pixelSha256);
        assert.equal(normal.pngSha256, base.pngSha256);
        assert.deepEqual(
          await readFile(path.join(DEFAULT_OUTPUT_ROOT, normal.output)),
          await readFile(path.join(DEFAULT_OUTPUT_ROOT, base.output)),
        );

        for (const record of records.filter(({ variant }) => variant !== 'normal')) {
          assert.equal(
            record.sourcePath,
            `assets/generated-v2/rig/${ownerId}/expressions-v2.png`,
          );
          assert.equal(record.width, base.width);
          assert.equal(record.height, base.height);
          assert.equal(
            record.output,
            `${ownerId}/expressions/${partId}--${record.variant}.png`,
          );
        }
      }
    });
  }
});

test('body, eyes, and mouth are independent atlas cells and pixel exports', async (t) => {
  assert.equal(MANIFEST.assetPolicy.bodyIncludesFacialPixels, false);
  for (const [ownerId, rig] of Object.entries(MANIFEST.rigs)) {
    await t.test(ownerId, async () => {
      const body = rig.parts.find(({ id }) => id === 'body')
        ?? rig.parts.find(({ id }) => id === 'stem');
      const eyes = rig.parts.find(({ id }) => id === 'eyes');
      const mouth = rig.parts.find(({ id }) => id === 'mouth');
      assert.ok(body, `${ownerId} needs a body or stem base layer`);
      assert.ok(eyes, `${ownerId} needs an eyes layer`);
      assert.ok(mouth, `${ownerId} needs a mouth layer`);

      for (const face of [eyes, mouth]) {
        assert.notEqual(face.id, body.id);
        assert.equal(
          rectanglesOverlap(body.sourceRect, face.sourceRect),
          false,
          `${body.id} and ${face.id} sourceRects must be disjoint`,
        );
      }
      assert.equal(rectanglesOverlap(eyes.sourceRect, mouth.sourceRect), false);

      const atlas = decodeRgbaPng(
        await readFile(path.join(PROJECT_ROOT, rig.parts[0].path)),
        rig.parts[0].path,
      );
      const bodyImage = crop(atlas, body.sourceRect);
      const bodyHash = sha256(bodyImage.pixels);
      for (const face of [eyes, mouth]) {
        const faceImage = crop(atlas, face.sourceRect);
        assert.notEqual(sha256(faceImage.pixels), bodyHash, `${face.id} cannot duplicate body pixels`);
        const match = placedFaceColorMatch(body, bodyImage, face, faceImage);
        assert.ok(match.compared > 0, `${face.id} must overlap the visible body at bind pose`);
        assert.ok(
          match.ratio < 0.9,
          `${ownerId}.${body.id} appears to contain a duplicate painted ${face.id} layer`,
        );
      }

      const bodyExport = await readFile(path.join(DEFAULT_OUTPUT_ROOT, ownerId, `${body.id}.png`));
      const eyesExport = await readFile(path.join(DEFAULT_OUTPUT_ROOT, ownerId, 'eyes.png'));
      const mouthExport = await readFile(path.join(DEFAULT_OUTPUT_ROOT, ownerId, 'mouth.png'));
      assert.equal(new Set([sha256(bodyExport), sha256(eyesExport), sha256(mouthExport)]).size, 3);
    });
  }
});

test('layer export reads only current atlas and expressions-v2 paths', async (t) => {
  async function rejectsAtlasPath(ownerId, atlasPath, expected) {
    const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'slime-rig-layers-'));
    const outputRoot = path.join(temporaryParent, 'rig-parts-exported');
    const manifestPath = path.join(temporaryParent, 'rig-parts.json');
    t.after(() => rm(temporaryParent, { recursive: true, force: true }));
    const manifest = JSON.parse(JSON.stringify(MANIFEST));
    for (const part of manifest.rigs[ownerId].parts) part.path = atlasPath;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(
      exportRigLayers({
        projectRoot: PROJECT_ROOT,
        manifestPath,
        outputRoot,
      }),
      expected,
    );
  }

  await rejectsAtlasPath(
    'enemy-acid-shell-king',
    'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v3.png',
    /outside the current rig atlas convention|expected atlas path .*atlas-layered-v2\.png/i,
  );
  await rejectsAtlasPath(
    'enemy-windcap',
    'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png',
    /outside the current rig atlas convention/i,
  );
  await rejectsAtlasPath(
    'enemy-windcap',
    'assets/generated-v2/rig/enemy-windcap/atlas-old.png',
    /outside the current rig atlas convention/i,
  );
  await rejectsAtlasPath(
    'enemy-windcap',
    'assets/generated-v2/rig/enemy-windcap/candidates/atlas.png',
    /forbidden preview\/review\/candidate/i,
  );
  await rejectsAtlasPath(
    'enemy-windcap',
    'assets/generated-v2/review/enemy-windcap/atlas.png',
    /forbidden preview\/review\/candidate/i,
  );

  async function rejectsExpressionPath(expressionPath, expected) {
    const temporaryParent = await mkdtemp(path.join(os.tmpdir(), 'slime-rig-layers-'));
    const outputRoot = path.join(temporaryParent, 'rig-parts-exported');
    const manifestPath = path.join(temporaryParent, 'rig-parts.json');
    t.after(() => rm(temporaryParent, { recursive: true, force: true }));
    const manifest = JSON.parse(JSON.stringify(MANIFEST));
    manifest.rigs['survivor-shell-shell'].parts
      .find(({ id }) => id === 'eyes').variants.blink.path = expressionPath;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(
      exportRigLayers({
        projectRoot: PROJECT_ROOT,
        manifestPath,
        outputRoot,
      }),
      expected,
    );
  }

  await rejectsExpressionPath(
    'assets/generated-v2/rig/survivor-shell-shell/expressions.png',
    /expected expression path .*expressions-v2\.png/i,
  );
  await rejectsExpressionPath(
    'assets/generated-v2/review/survivor-shell-shell/expressions-v2.png',
    /forbidden preview\/review\/candidate/i,
  );
  await rejectsExpressionPath(
    'assets/generated-v2/rig/survivor-shell-shell/candidates/expressions-v2.png',
    /forbidden preview\/review\/candidate/i,
  );
  await rejectsExpressionPath(
    'assets/generated-v2/rig/survivor-shell-shell/preview/expressions-v2.png',
    /forbidden preview\/review\/candidate/i,
  );
});
