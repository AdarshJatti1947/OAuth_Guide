const form = document.querySelector('#prompt-form');
if (form) {
  const input = document.querySelector('#prompt');
  const submit = document.querySelector('#submit-prompt');
  const panel = document.querySelector('#job-panel');
  const heading = document.querySelector('#job-heading');
  const message = document.querySelector('#job-message');
  const actions = document.querySelector('#job-actions');
  const stages = ['input_analyser', 'web_search', 'validator', 'organiser'];
  const stageLabels = ['Identify product', 'Research official sources', 'Validate requirements', 'Organise your guide'];
  const meta = document.querySelector('#progress-meta');
  const activity = document.querySelector('#progress-activity');
  let latestJob = null, lastResponse = 0;
  const duration = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`; };
  function showTime() {
    if (!latestJob || !meta) return;
    const running = ['running', 'queued'].includes(latestJob.status);
    const end = running ? Date.now() : Date.parse(latestJob.updated_at);
    const elapsed = duration(end - Date.parse(latestJob.created_at));
    const age = Math.floor((Date.now() - lastResponse) / 1000);
    meta.textContent = `${running ? 'Elapsed' : 'Total time'}: ${elapsed}${running ? ` · ${age < 5 ? 'Connected to server' : `Last server response ${age}s ago`}` : ''}`;
    if (running && latestJob.heartbeat_at) meta.textContent += ` · Backend update: ${duration(Date.now() - Date.parse(latestJob.heartbeat_at))} ago`;
    if (running && latestJob.stage_started_at) meta.textContent += ` · This stage: ${duration(Date.now() - Date.parse(latestJob.stage_started_at))}`;
  }
  setInterval(showTime, 1000);
  let timer, generation = 0;
  const storageKey = 'oauth-guide-current-job';
  function remember(id) { try { localStorage.setItem(storageKey, id); } catch {} }
  function forget() { try { localStorage.removeItem(storageKey); } catch {} }
  function stageView(stage, status) {
    const complete = status === 'completed';
    document.querySelectorAll('[data-stage]').forEach(li => {
      const index = stages.indexOf(li.dataset.stage), current = stages.indexOf(stage);
      li.classList.toggle('current', !complete && index === current);
      li.classList.toggle('done', complete || index < current);
      const label = complete || index < current ? 'Completed' : index === current ? ({ running: 'In progress', queued: 'Queued', failed: 'Stopped', needs_clarification: 'Needs your input' }[status] || 'Waiting') : 'Pending';
      li.replaceChildren();
      const name = document.createElement('span'); name.textContent = stageLabels[index];
      const state = document.createElement('strong'); state.textContent = label;
      li.append(name, state);
      li.classList.toggle('working', status === 'running' && index === current);
      li.classList.toggle('stopped', status === 'failed' && index === current);
    });
  }
  async function poll(id, token) {
    if (token !== generation) return;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      const job = await res.json();
      if (token !== generation) return;
      if (!res.ok) {
        if (res.status === 404) {
          forget(); submit.disabled = false;
          heading.textContent = 'Request not found'; message.textContent = 'Submit your question to start a new guide.';
          return;
        }
        throw new Error(job.error || 'Unable to load generation progress.');
      }
      panel.hidden = false;
      latestJob = job; lastResponse = Date.now(); showTime();
      if (activity) activity.textContent = job.status === 'running'
        ? (/Still waiting/.test(job.activity || '') ? 'The backend is waiting for the AI provider’s response. This confirms the request is pending, not a percentage of completion.' : job.activity || '') : '';
      if (!input.value) input.value = job.prompt;
      stageView(job.stage, job.status);
      if (job.status === 'completed') {
        heading.textContent = 'Your guide is ready';
        message.textContent = 'Open it in a new tab or copy the link to share it.';
        const link = document.querySelector('#open-generated');
        link.href = job.guide_url;
        document.querySelector('#copy-generated').onclick = async () => {
          const url = new URL(job.guide_url, location.origin).href;
          try { await navigator.clipboard.writeText(url); message.textContent = 'Guide link copied.'; }
          catch { message.textContent = `Copy this link: ${url}`; }
        };
        actions.hidden = false; submit.disabled = false;
        return;
      }
      if (job.status === 'needs_clarification') {
        heading.textContent = 'A little more detail'; message.textContent = job.clarification;
        input.value = job.prompt; input.focus(); submit.disabled = false; forget(); return;
      }
      if (job.status === 'failed') {
        const stageNames = { input_analyser: 'Input-analyser', web_search: 'Web-search', validator: 'Validator', organiser: 'Organiser' };
        heading.textContent = `Generation stopped · ${stageNames[job.stage] || job.stage}`; message.textContent = job.error;
        submit.disabled = false; forget(); return;
      }
      heading.textContent = job.status === 'queued' ? 'Your request is queued' : `Step ${stages.indexOf(job.stage) + 1} of 4 · ${stageLabels[stages.indexOf(job.stage)]}`;
      const labels = { input_analyser: 'Identifying the exact product and your integration needs.', web_search: 'Researching official setup and approval documentation.', validator: 'Checking requirements and researching missing evidence. This stage may include a repair round.', organiser: 'Organising the findings into your guide.' };
      message.textContent = job.status === 'queued' ? 'Your guide will start when the current request finishes.' : labels[job.stage];
      timer = setTimeout(() => poll(id, token), 2000);
    } catch (error) {
      if (token !== generation) return;
      heading.textContent = 'Connection interrupted'; message.textContent = `${error.message} Checking again shortly…`;
      document.querySelectorAll('.working').forEach(li => li.classList.remove('working'));
      if (activity) activity.textContent = 'Progress is temporarily unavailable. The backend job may still be running; no new generation has been started.';
      timer = setTimeout(() => poll(id, token), 5000);
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !input.value.trim()) return;
    clearTimeout(timer);
    const token = ++generation;
    latestJob = null;
    if (meta) meta.textContent = '';
    if (activity) activity.textContent = '';
    stageView('input_analyser', 'queued');
    submit.disabled = true; panel.hidden = false; actions.hidden = true;
    heading.textContent = 'Starting your guide'; message.textContent = 'Sending your question…';
    const requestId = crypto.randomUUID();
    let rejected = false;
    remember(requestId);
    try {
      const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: input.value.trim(), request_id: requestId }) });
      const result = await res.json();
      if (!res.ok) { rejected = true; throw new Error(result.error || 'Could not start generation.'); }
      remember(result.id);
      poll(result.id, token);
    } catch (error) {
      if (rejected) {
        forget(); heading.textContent = 'Could not start'; message.textContent = error.message; submit.disabled = false;
      } else {
        heading.textContent = 'Checking your request'; message.textContent = 'The connection was interrupted. Checking whether generation started before allowing another submission.';
        poll(requestId, token);
      }
    }
  });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
  let current;
  try { current = localStorage.getItem(storageKey); } catch {}
  if (current) { submit.disabled = true; panel.hidden = false; poll(current, ++generation); }
}
