import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { configuration, runPipeline } from './pipeline.mjs';
import { runOrganiser } from './organiser.mjs';
import { createOpenAIRequest, redactor, ownerContact } from './openai.mjs';

export function createJobService({ store, env = process.env, request, pipeline = runPipeline, organiser = runOrganiser,
  artifactsRoot = resolve('runs'), maxQueued = 3, hourlyLimit = 10, log = console.log }) {
  const queue = [];
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  const redact = redactor(apiKey);
  let active = null, stopped = false;
  store.interruptPendingJobs();
  async function execute(id) {
    const job = store.getJob(id);
    let stage = 'input_analyser';
    const onStage = value => {
      stage = value;
      store.updateJob(id, { status: 'running', stage });
    };
    try {
      const directory = join(artifactsRoot, id);
      await mkdir(directory, { recursive: true });
      const save = async (name, value) => writeFile(join(directory, name), redact(typeof value === 'string' ? value : JSON.stringify(value, null, 2)), { flag: 'wx', mode: 0o600 });
      onStage('input_analyser');
      const activity = message => {
        store.updateJobProgress(id, redact(message));
        log(redact(`[${id}] ${message}`));
      };
      const call = request || createOpenAIRequest(apiKey, activity);
      const report = await pipeline({ prompt: job.prompt, config: configuration(env), request: call, save, onStage,
        progress: activity });
      if (report.status === 'needs_clarification') {
        store.updateJob(id, { status: 'needs_clarification', stage, clarification: report.identity.clarification_question });
        return;
      }
      onStage('organiser');
      activity('Organising the validated report into the final guide.');
      const guide = await organiser({ report, prompt: job.prompt, request: call, model: env.ORGANISER_MODEL || 'gpt-5.4-mini' });
      await save('organised-guide.json', guide);
      store.completeJob(id, guide);
    } catch (error) {
      log(redact(`[${id}] Generation failed: ${error.message}`));
      store.updateJob(id, { status: 'failed', stage,
        error: error.isModelApiError ? redact(error.publicMessage)
          : `Generation could not finish. Check the server logs for details. No automatic retry was made.\n\n${ownerContact}` });
    }
  }
  function pump() {
    if (active || stopped || !queue.length) return;
    active = execute(queue.shift()).finally(() => { active = null; pump(); });
  }
  return {
    get enabled() { return Boolean(apiKey || request); },
    submit(prompt, requestId = randomUUID()) {
      if (stopped) throw Object.assign(new Error('Server is stopping.'), { status: 503 });
      if (!apiKey && !request) throw Object.assign(new Error(`Live generation is not configured: the server has no AI API key loaded.\n\n${ownerContact}`), { status: 503 });
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) throw Object.assign(new Error('Enter a question between 1 and 6,000 characters.'), { status: 400 });
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) throw Object.assign(new Error('Invalid request identifier.'), { status: 400 });
      const existing = store.getJob(requestId);
      if (existing) {
        if (existing.prompt !== prompt.trim()) throw Object.assign(new Error('Request identifier already used for a different question.'), { status: 409 });
        return requestId;
      }
      configuration(env);
      if (queue.length >= maxQueued || store.recentJobCount(new Date(Date.now() - 3600_000).toISOString()) >= hourlyLimit) {
        throw Object.assign(new Error('Generation limit reached. Please try again later.'), { status: 429 });
      }
      const id = store.createJob(prompt.trim(), requestId);
      queue.push(id);
      // Start outside the HTTP submission so the browser gets a job ID immediately.
      setTimeout(pump, 0);
      return id;
    },
    get(id) {
      const job = store.getJob(id);
      if (!job) return null;
      const guide = job.guide_id ? store.getGuideById(job.guide_id) : null;
      return { id: job.id, prompt: job.prompt, status: job.status, stage: job.stage, clarification: job.clarification,
        error: job.error, guide_url: guide ? `/guides/${guide.slug}` : null, updated_at: job.updated_at,
        created_at: job.created_at, stage_started_at: job.stage_started_at,
        heartbeat_at: job.heartbeat_at, activity: job.progress_message };
    },
    async idle() {
      // Test/shutdown hook; normal HTTP requests do not wait for generation.
      while (queue.length || active) {
        pump();
        if (active) await active;
        else break;
      }
    },
    stop() { stopped = true; },
  };
}
