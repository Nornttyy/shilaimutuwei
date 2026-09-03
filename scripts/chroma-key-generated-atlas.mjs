#!/usr/bin/env node

import { inflateSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeRgbaPng, PNG_SIGNATURE } from './export-rig-layers.mjs';
import { resizeRgbaBilinear } from './build-boss-layered-atlas.mjs';

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

/** Decode non-interlaced 8-bit RGB or RGBA PNGs emitted by image generation. */
export function decodeGeneratedPng(input, label = 'generated PNG') {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label}: invalid PNG signature`);
  }

  let offset = 8;
  let header = null;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`${label}: truncated PNG chunk`);
    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        compression: buffer[dataStart + 10],
        filter: buffer[dataStart + 11],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      imageData.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (
    !header
    || imageData.length === 0
    || header.bitDepth !== 8
    || ![2, 6].includes(header.colorType)
    || header.compression !== 0
    || header.filter !== 0
    || header.interlace !== 0
  ) {
    throw new Error(`${label}: expected a non-interlaced 8-bit RGB or RGBA PNG`);
  }

  const sourceChannels = header.colorType === 6 ? 4 : 3;
  const rowBytes = header.width * sourceChannels;
  const filtered = inflateSync(Buffer.concat(imageData));
  if (filtered.length !== (rowBytes + 1) * header.height) {
    throw new Error(`${label}: unexpected decoded byte count`);
  }

  const decoded = Buffer.alloc(rowBytes * header.height);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = filtered[sourceOffset];
    sourceOffset += 1;
    if (filterType > 4) throw new Error(`${label}: unsupported row filter ${filterType}`);
    const rowOffset = y * rowBytes;
    const previousRowOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= sourceChannels ? decoded[rowOffset + x - sourceChannels] : 0;
      const up = y > 0 ? decoded[previousRowOffset + x] : 0;
      const upperLeft = y > 0 && x >= sourceChannels
        ? decoded[previousRowOffset + x - sourceChannels]
        : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = Math.floor((left + up) / 2);
      else if (filterType === 4) predictor = paethPredictor(left, up, upperLeft);
      decoded[rowOffset + x] = (raw + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }

  const pixels = Buffer.alloc(header.width * header.height * 4);
  for (let index = 0; index < header.width * header.height; index += 1) {
    const source = index * sourceChannels;
    const target = index * 4;
    pixels[target] = decoded[source];
    pixels[target + 1] = decoded[source + 1];
    pixels[target + 2] = decoded[source + 2];
    pixels[target + 3] = sourceChannels === 4 ? decoded[source + 3] : 255;
  }
  return { width: header.width, height: header.height, pixels };
}

function colorDistance(red, green, blue, key) {
  return Math.hypot(red - key[0], green - key[1], blue - key[2]);
}

/**
 * Remove a generated chroma background without touching similarly hued art.
 * Exact-key pixels seed every background island (including enclosed icon holes),
 * then the mask only grows through key-dominant antialiased pixels.
 */
export function chromaKey(image, {
  key = [0, 255, 0],
  seedDistance = 58,
  edgeDistance = 178,
  minimumDominance = 48,
} = {}) {
  const pixelCount = image.width * image.height;
  const mask = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const distanceAt = (index) => {
    const offset = index * 4;
    return colorDistance(
      image.pixels[offset],
      image.pixels[offset + 1],
      image.pixels[offset + 2],
      key,
    );
  };
  const dominanceAt = (index) => {
    const offset = index * 4;
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    return green - Math.max(red, blue);
  };
  const eligible = (index) => distanceAt(index) <= edgeDistance
    && dominanceAt(index) >= minimumDominance;

  for (let index = 0; index < pixelCount; index += 1) {
    if (distanceAt(index) <= seedDistance && dominanceAt(index) >= minimumDominance) {
      mask[index] = 1;
      queue[tail] = index;
      tail += 1;
    }
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    const neighbors = [];
    if (x > 0) neighbors.push(index - 1);
    if (x + 1 < image.width) neighbors.push(index + 1);
    if (y > 0) neighbors.push(index - image.width);
    if (y + 1 < image.height) neighbors.push(index + image.width);
    for (const neighbor of neighbors) {
      if (mask[neighbor] || !eligible(neighbor)) continue;
      mask[neighbor] = 1;
      queue[tail] = neighbor;
      tail += 1;
    }
  }

  const pixels = Buffer.from(image.pixels);
  for (let index = 0; index < pixelCount; index += 1) {
    if (!mask[index]) continue;
    const offset = index * 4;
    const distance = distanceAt(index);
    const sourceAlpha = pixels[offset + 3] / 255;
    const matteAlpha = distance <= seedDistance
      ? 0
      : Math.min(1, Math.max(0, (distance - seedDistance) / (edgeDistance - seedDistance)));
    const alpha = sourceAlpha * matteAlpha;
    if (alpha <= 0.015) {
      pixels.fill(0, offset, offset + 4);
      continue;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const composited = pixels[offset + channel];
      const foreground = (composited - (1 - alpha) * key[channel]) / alpha;
      pixels[offset + channel] = Math.round(Math.min(255, Math.max(0, foreground)));
    }
    pixels[offset + 3] = Math.round(alpha * 255);
  }

  return { width: image.width, height: image.height, pixels };
}

function parseSize(value) {
  if (!value) return null;
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid output size: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function main() {
  const [, , inputPath, outputPath, sizeArgument] = process.argv;
  if (!inputPath || !outputPath) {
    throw new Error('Usage: node scripts/chroma-key-generated-atlas.mjs INPUT OUTPUT [WIDTHxHEIGHT]');
  }
  const input = decodeGeneratedPng(await readFile(inputPath), inputPath);
  const keyed = chromaKey(input);
  const size = parseSize(sizeArgument);
  const output = size ? resizeRgbaBilinear(keyed, size.width, size.height) : keyed;
  await writeFile(outputPath, encodeRgbaPng(output));
  console.log(`Wrote ${output.width}x${output.height} transparent atlas: ${outputPath}`);
}

const directlyExecuted = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directlyExecuted) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
