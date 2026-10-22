import { renderGuide, renderLibrary, renderNotFound, renderHome } from './pages.mjs';

export function createHandler(store, assets, jobs = null) {
  return async (req, res) => {
    const headers = {
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    };
    function send(status, body, type = 'text/html; charset=utf-8') {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
    const json = (status, value) => send(status, JSON.stringify(value), 'application/json; charset=utf-8');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'POST' && path === '/api/jobs') {
        if (!jobs) { json(503, { error: 'Generation is not configured.' }); return; }
        if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') {
          json(403, { error: 'Submit from this website.' }); return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) { json(415, { error: 'Expected JSON.' }); return; }
        let body = '', bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 24000) { json(413, { error: 'Question is too large.' }); return; }
          body += chunk;
        }
        let input;
        try { input = JSON.parse(body); } catch { json(400, { error: 'Invalid JSON.' }); return; }
        const id = jobs.submit(input.prompt, input.request_id);
        json(202, { id, status_url: `/api/jobs/${id}` }); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); send(405, 'Method not allowed', 'text/plain'); return; }
      const jobMatch = path.match(/^\/api\/jobs\/([a-f0-9-]{36})$/i);
      if (jobMatch) {
        const job = jobs?.get(jobMatch[1]); json(job ? 200 : 404, job || { error: 'Job not found.' }); return;
      }
      if (assets[path]) { send(200, assets[path].body, assets[path].type); return; }
      if (path === '/') { send(200, renderHome(store.listGuides(), jobs?.enabled)); return; }
      if (path === '/library') { send(200, renderLibrary(store.listGuides())); return; }
      if (path === '/health') { send(200, 'ok', 'text/plain'); return; }
      const match = path.match(/^\/guides\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
      const row = match && store.getGuide(match[1]);
      send(row ? 200 : 404, row ? renderGuide(row) : renderNotFound());
    } catch (error) {
      if (req.url?.startsWith('/api/')) json(error.status || 500, { error: error.status ? error.message : 'Request could not be completed.' });
      else send(500, 'Unable to load this guide.', 'text/plain');
    }
  };
}
