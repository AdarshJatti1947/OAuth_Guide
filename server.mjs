import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openStore } from './lib/store.mjs';
import { createHandler } from './lib/http.mjs';
import { createJobService } from './lib/jobs.mjs';

const port = Number(process.env.PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const store = openStore(resolve(process.env.DATABASE_PATH || 'data/oauth-guide.db'));
const assets = {};
for (const [file, type] of [['guide.css', 'text/css; charset=utf-8'], ['guide.js', 'text/javascript; charset=utf-8'], ['chat.css', 'text/css; charset=utf-8'], ['chat.js', 'text/javascript; charset=utf-8']]) {
  assets[`/assets/${file}`] = { body: await readFile(new URL(`./public/${file}`, import.meta.url)), type };
}
const jobs = createJobService({ store });
const server = createServer(createHandler(store, assets, jobs));
server.on('error', error => { console.error(`Server failed: ${error.code || error.message}`); store.close(); process.exitCode = 1; });
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`OAuth Guide: http://localhost:${port}\nLive generation: ${jobs.enabled ? 'enabled; submitting a prompt makes paid API requests' : 'disabled; start with --env-file=.env to enable'}. Viewing guides never runs agents.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { jobs.stop(); server.close(() => { store.close(); process.exit(0); }); });
