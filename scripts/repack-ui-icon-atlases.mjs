#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { alphaComponents4 } from './build-bubble-layered-atlas.mjs';
import { resizeRgbaBilinear } from './build-boss-layered-atlas.mjs';
import {
  alphaStats,
  decodeRgbaPng,
  encodeRgbaPng,
  PROJECT_ROOT,
} from './export-rig-layers.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REQUIRED_MARGIN = 24;

export const UI_ICON_ATLAS_LAYOUTS = Object.freeze([
  Object.freeze({
    id: 'menu-actions',
    path: path.join(PROJECT_ROOT, 'assets/generated/ui/ui-menu-actions-atlas-v1.png'),
    width: 1254,
    height: 836,
    columns: 3,
    rows: 2,
  }),
  Object.freeze({
    id: 'battle-hud',
    path: path.join(PROJECT_ROOT, 'assets/generated/ui/ui-battle-hud-atlas-v1.png'),
    width: 1024,
    height: 1536,
    columns: 2,
    rows: 3,
  }),
]);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function relative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function assertLayout(layout) {
  if (
    !Number.isInteger(layout.width)
    || !Number.isInteger(layout.height)
    || !Number.isInteger(layout.columns)
    || !Number.isInteger(layout.rows)
    || layout.width <= 0
    || layout.height <= 0
    || layout.columns <= 0
    || layout.rows <= 0
    || layout.width % layout.columns !== 0
    || layout.height % layout.rows !== 0
  ) {
    throw new Error(`${layout.id}: atlas dimensions do not divide into an integer grid`);
  }
  const approved = UI_ICON_ATLAS_LAYOUTS.some((candidate) => (
    path.resolve(candidate.path) === path.resolve(layout.path)
  ));
  if (!approved) throw new Error(`${layout.id}: output path is not approved`);
  const cellWidth = layout.width / layout.columns;
  const cellHeight = layout.height / layout.rows;
  if (cellWidth <= REQUIRED_MARGIN * 2 || cellHeight <= REQUIRED_MARGIN * 2) {
    throw new Error(`${layout.id}: ${REQUIRED_MARGIN}px margins leave no drawable cell area`);
  }
  return { cellWidth, cellHeight };
}

/** Copy only one connected component into a tight transparent RGBA image. */
function isolateComponent(source, component) {
  const { bounds } = component;
  const pixels = Buffer.alloc(bounds.width * bounds.height * 4);
  for (const sourceIndex of component.indices) {
    const sourceX = sourceIndex % source.width;
    const sourceY = Math.floor(sourceIndex / source.width);
    const targetX = sourceX - bounds.x;
    const targetY = sourceY - bounds.y;
    const sourceOffset = sourceIndex * 4;
    const targetOffset = (targetY * bounds.width + targetX) * 4;
    source.pixels.copy(pixels, targetOffset, sourceOffset, sourceOffset + 4);
  }
  return { width: bounds.width, height: bounds.height, pixels };
}

function alphaCentroid(source, component) {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  for (const index of component.indices) {
    const alpha = source.pixels[index * 4 + 3];
    weightedX += (index % source.width) * alpha;
    weightedY += Math.floor(index / source.width) * alpha;
    weight += alpha;
  }
  if (weight <= 0) throw new Error('Connected alpha component has no visible weight');
  return { x: weightedX / weight, y: weightedY / weight };
}

function assignComponentsToCells(source, components, layout, cellWidth, cellHeight) {
  const assigned = new Map();
  for (const component of components) {
    const centroid = alphaCentroid(source, component);
    const column = Math.max(0, Math.min(
      layout.columns - 1,
      Math.floor(centroid.x / cellWidth),
    ));
    const row = Math.max(0, Math.min(
      layout.rows - 1,
      Math.floor(centroid.y / cellHeight),
    ));
    const cellIndex = row * layout.columns + column;
    if (assigned.has(cellIndex)) {
      throw new Error(
        `${layout.id}: multiple dominant components map to cell ${column},${row}`,
      );
    }
    assigned.set(cellIndex, { component, centroid, column, row });
  }
  const expectedCount = layout.columns * layout.rows;
  if (assigned.size !== expectedCount) {
    throw new Error(`${layout.id}: expected one dominant component in all ${expectedCount} cells`);
  }
  return [...assigned.values()].sort((left, right) => (
    left.row - right.row || left.column - right.column
  ));
}

function blit(target, source, x, y) {
  if (
    x < 0
    || y < 0
    || x + source.width > target.width
    || y + source.height > target.height
  ) {
    throw new Error('RGBA blit falls outside the target atlas');
  }
  for (let row = 0; row < source.height; row += 1) {
    const sourceStart = row * source.width * 4;
    const targetStart = ((y + row) * target.width + x) * 4;
    source.pixels.copy(
      target.pixels,
      targetStart,
      sourceStart,
      sourceStart + source.width * 4,
    );
  }
}

/** Keep transparent texels canonical so rerunning the repack is byte-stable. */
function clearTransparentRgb(image) {
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    if (image.pixels[offset + 3] !== 0) continue;
    image.pixels[offset] = 0;
    image.pixels[offset + 1] = 0;
    image.pixels[offset + 2] = 0;
  }
}

function visibleAlphaBounds(image, rect) {
  let left = rect.width;
  let top = rect.height;
  let right = -1;
  let bottom = -1;
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const x = rect.x + localX;
      const y = rect.y + localY;
      if (image.pixels[(y * image.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, localX);
      top = Math.min(top, localY);
      right = Math.max(right, localX);
      bottom = Math.max(bottom, localY);
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function alphaCountOnGridLines(image, layout, cellWidth, cellHeight) {
  let count = 0;
  for (let column = 1; column < layout.columns; column += 1) {
    const x = column * cellWidth;
    for (let y = 0; y < image.height; y += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] > 0) count += 1;
    }
  }
  for (let row = 1; row < layout.rows; row += 1) {
    const y = row * cellHeight;
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] > 0) count += 1;
    }
  }
  return count;
}

export function auditUiIconAtlas(image, layout) {
  const { cellWidth, cellHeight } = assertLayout(layout);
  if (image.width !== layout.width || image.height !== layout.height) {
    throw new Error(
      `${layout.id}: got ${image.width}x${image.height}, expected ${layout.width}x${layout.height}`,
    );
  }
  const cells = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const rect = {
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      };
      const bounds = visibleAlphaBounds(image, rect);
      if (!bounds) throw new Error(`${layout.id}: cell ${column},${row} is empty`);
      const margins = {
        left: bounds.x,
        top: bounds.y,
        right: cellWidth - bounds.x - bounds.width,
        bottom: cellHeight - bounds.y - bounds.height,
      };
      if (Math.min(...Object.values(margins)) < REQUIRED_MARGIN) {
        throw new Error(
          `${layout.id}: cell ${column},${row} has less than ${REQUIRED_MARGIN}px transparent padding `
          + `(${JSON.stringify(margins)})`,
        );
      }
      cells.push({ column, row, alphaBounds: bounds, margins });
    }
  }

  const components = alphaComponents4(image);
  const expectedComponents = layout.columns * layout.rows;
  if (components.length !== expectedComponents) {
    throw new Error(
      `${layout.id}: output has ${components.length} alpha components, expected ${expectedComponents}`,
    );
  }
  const boundaryAlphaPixels = alphaCountOnGridLines(image, layout, cellWidth, cellHeight);
  if (boundaryAlphaPixels !== 0) {
    throw new Error(`${layout.id}: ${boundaryAlphaPixels} visible pixels remain on grid lines`);
  }
  const stats = alphaStats(image.pixels);
  if (stats.visiblePixels <= 0 || stats.transparentPixels <= 0) {
    throw new Error(`${layout.id}: atlas must contain both visible and transparent pixels`);
  }
  return {
    width: image.width,
    height: image.height,
    columns: layout.columns,
    rows: layout.rows,
    cellWidth,
    cellHeight,
    requiredMargin: REQUIRED_MARGIN,
    alphaComponents: components.length,
    boundaryAlphaPixels,
    ...stats,
    cells,
  };
}

export function repackUiIconAtlas(source, layout) {
  const { cellWidth, cellHeight } = assertLayout(layout);
  if (source.width !== layout.width || source.height !== layout.height) {
    throw new Error(
      `${layout.id}: got ${source.width}x${source.height}, expected ${layout.width}x${layout.height}`,
    );
  }

  const expectedComponents = layout.columns * layout.rows;
  const allComponents = alphaComponents4(source);
  if (allComponents.length < expectedComponents) {
    throw new Error(
      `${layout.id}: found ${allComponents.length} alpha components, expected at least ${expectedComponents}`,
    );
  }
  const dominant = allComponents.slice(0, expectedComponents);
  const assignments = assignComponentsToCells(
    source,
    dominant,
    layout,
    cellWidth,
    cellHeight,
  );
  const output = {
    width: source.width,
    height: source.height,
    pixels: Buffer.alloc(source.width * source.height * 4),
  };
  const availableWidth = cellWidth - REQUIRED_MARGIN * 2;
  const availableHeight = cellHeight - REQUIRED_MARGIN * 2;
  const cells = [];

  for (const assignment of assignments) {
    const isolated = isolateComponent(source, assignment.component);
    const scale = Math.min(
      availableWidth / isolated.width,
      availableHeight / isolated.height,
    );
    const width = Math.max(1, Math.min(availableWidth, Math.round(isolated.width * scale)));
    const height = Math.max(1, Math.min(availableHeight, Math.round(isolated.height * scale)));
    const resized = resizeRgbaBilinear(isolated, width, height);
    clearTransparentRgb(resized);
    const x = assignment.column * cellWidth + Math.floor((cellWidth - width) / 2);
    const y = assignment.row * cellHeight + Math.floor((cellHeight - height) / 2);
    blit(output, resized, x, y);
    cells.push({
      column: assignment.column,
      row: assignment.row,
      sourceCentroid: assignment.centroid,
      sourceBounds: { ...assignment.component.bounds },
      sourcePixels: assignment.component.area,
      scale,
      outputRect: { x, y, width, height },
    });
  }

  return {
    image: output,
    sourceComponentCount: allComponents.length,
    retainedComponentCount: dominant.length,
    droppedComponentCount: Math.max(0, allComponents.length - dominant.length),
    cells,
  };
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function processLayout(layout, { checkOnly }) {
  const sourceBytes = await readFile(layout.path);
  const source = decodeRgbaPng(sourceBytes, relative(layout.path));
  if (checkOnly) {
    return {
      id: layout.id,
      path: relative(layout.path),
      pngSha256: sha256(sourceBytes),
      audit: auditUiIconAtlas(source, layout),
    };
  }

  const repacked = repackUiIconAtlas(source, layout);
  const png = encodeRgbaPng(repacked.image);
  const roundTrip = decodeRgbaPng(png, `${layout.id} repacked PNG`);
  if (!roundTrip.pixels.equals(repacked.image.pixels)) {
    throw new Error(`${layout.id}: PNG round trip changed RGBA pixels`);
  }
  const audit = auditUiIconAtlas(roundTrip, layout);
  await writeAtomically(layout.path, png);
  return {
    id: layout.id,
    path: relative(layout.path),
    pngSha256: sha256(png),
    sourceComponentCount: repacked.sourceComponentCount,
    retainedComponentCount: repacked.retainedComponentCount,
    droppedComponentCount: repacked.droppedComponentCount,
    cells: repacked.cells,
    audit,
  };
}

export async function repackUiIconAtlases({ checkOnly = false } = {}) {
  const reports = [];
  for (const layout of UI_ICON_ATLAS_LAYOUTS) {
    reports.push(await processLayout(layout, { checkOnly }));
  }
  return { mode: checkOnly ? 'check' : 'repack', reports };
}

const directlyExecuted = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (directlyExecuted) {
  const args = new Set(process.argv.slice(2));
  const allowed = new Set(['--check']);
  const unknown = [...args].filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    process.exitCode = 2;
  } else {
    try {
      const report = await repackUiIconAtlases({ checkOnly: args.has('--check') });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    }
  }
}
