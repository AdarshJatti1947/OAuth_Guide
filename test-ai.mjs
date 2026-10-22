import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { configuration, runPipeline } from './lib/pipeline.mjs';
import { runOrganiser } from './lib/organiser.mjs';
import { createOpenAIRequest, redactor } from './lib/openai.mjs';

// Credentials are loaded only by the user's Node --env-file command.
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const redact = redactor(apiKey);
let directory;
try {
  const config = configuration(process.env);
  const prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) throw new Error('Provide the complete request: node --env-file=.env test-ai.mjs "What must I configure so users can connect Gmail to my assistant?"');
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY (or AI_API_KEY).');
  directory = resolve('runs', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8));
  await mkdir(directory, { recursive: true });
  async function save(name, value) {
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    await writeFile(join(directory, name), redact(content), { flag: 'wx', mode: 0o600 });
  }
  console.log(`Models: analyser=${config.analyserModel}; research/validator=${config.researchModel}`);
  console.log(`Tool-call ceilings: research=${config.searchCalls}, validator=${config.validatorCalls} per round, up to ${config.validatorRounds} rounds. These are not dollar caps.`);
  console.log(`Artifacts: ${directory}`);
  const request = createOpenAIRequest(apiKey);
  const result = await runPipeline({ prompt, config, request, save,
    progress: message => console.log(redact(message)) });
  if (result.status === 'needs_clarification') {
    console.log(`\nClarification needed: ${redact(result.identity.clarification_question)}`);
    console.log('Rerun with a more specific full request. No research or validator call was made.');
  } else {
    console.log(`\nStatus: ${result.status}`);
    console.log(redact(result.validation.guide_markdown));
    for (const warning of result.warnings) console.error(redact(warning));
    console.log(`\nSaved final guide: ${join(directory, 'guide.md')}`);
    console.log(`Saved audit, references, corrections and per-stage usage: ${join(directory, 'validation.json')}`);
    console.log('4/4 Organiser: structuring the validated guide…');
    const organised = await runOrganiser({ report: result, prompt, request, model: process.env.ORGANISER_MODEL || 'gpt-5.4-mini' });
    await save('organised-guide.json', organised);
    console.log(`Saved structured guide: ${join(directory, 'organised-guide.json')}`);
    if (result.status === 'needs_review') process.exitCode = 2;
  }
} catch (error) {
  console.error(redact(error.name === 'TimeoutError'
    ? 'Request timed out; server-side work may still incur charges. No automatic retry was made.'
    : error.message));
  if (directory) console.error(`Completed stages remain in ${directory}.`);
  process.exitCode = 1;
}
