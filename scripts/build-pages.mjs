import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = path.join(projectRoot, '_site');
const publishEntries = ['index.html', 'styles.css', 'src'];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of publishEntries) {
  await cp(path.join(projectRoot, entry), path.join(outputDirectory, entry), {
    recursive: true,
  });
}

const outputEntries = await readdir(outputDirectory, { recursive: true });
const imageFiles = outputEntries.filter((entry) => /\.(?:avif|gif|jpe?g|png|webp)$/i.test(entry));

if (imageFiles.length > 0) {
  throw new Error(`Pages output unexpectedly contains image files: ${imageFiles.join(', ')}`);
}

console.log(`GitHub Pages site built at ${outputDirectory}`);
