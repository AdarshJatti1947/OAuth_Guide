import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { openStore } from './lib/store.mjs';

let store;
try {
  const [file, slug] = process.argv.slice(2);
  if (!file || !['guide.display.json', 'guide.json', 'organised-guide.json'].includes(basename(file))) throw new Error('Usage: node import-guide.mjs runs/<run>/<organised>/guide.display.json [unique-slug]');
  const guide = JSON.parse(await readFile(resolve(file), 'utf8'));
  store = openStore(resolve(process.env.DATABASE_PATH || 'data/oauth-guide.db'));
  const saved = store.insertGuide(guide, slug);
  console.log(`Imported: ${saved.slug}\nOpen: http://localhost:4174/guides/${saved.slug}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store?.close(); }
