import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { runOrganiser } from './lib/organiser.mjs';
import { createOpenAIRequest, redactor } from './lib/openai.mjs';

const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const redact = redactor(apiKey);
try {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--from', '--prompt'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Usage: node --env-file=.env organise-guide.mjs --from runs/<run>/validation.json [--prompt "original question"]');
    options[args[i]] = args[i + 1];
  }
  if (!options['--from']) throw new Error('Provide --from runs/<run>/validation.json.');
  const file = resolve(options['--from']);
  if (basename(file) !== 'validation.json') throw new Error('--from must point to a saved validation.json; credential files must never be supplied.');
  const report = JSON.parse(await readFile(file, 'utf8'));
  const prompt = options['--prompt'] || report.original_request;
  if (!prompt) throw new Error('This older report has no saved original prompt. Supply --prompt "original question".');
  const model = process.env.ORGANISER_MODEL || 'gpt-5.4-mini';
  const request = createOpenAIRequest(apiKey);
  console.log(`Organiser only: ${model}. No research, validation, web search, or database writes.`);
  const guide = await runOrganiser({ report, prompt, model, request });
  const directory = join(dirname(file), `organised-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'guide.json'), redact(JSON.stringify(guide, null, 2)), { flag: 'wx', mode: 0o600 });
  console.log(`Saved organised guide: ${join(directory, 'guide.json')}`);
  console.log(`Title: ${guide.content.title}\nSections: ${guide.content.sections.length}\nSources: ${guide.sources.length}`);
  console.log(`Input tokens: ${guide.organiser.usage.input_tokens ?? 'not reported'}; output tokens: ${guide.organiser.usage.output_tokens ?? 'not reported'}`);
  console.log('Structure and reference checks passed. Semantic fidelity still needs review against the validator report.');
} catch (error) {
  console.error(redact(error.name === 'TimeoutError' ? 'Request timed out; it may still incur charges. No automatic retry was made.' : error.message));
  process.exitCode = 1;
}
