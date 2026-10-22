export function redactor(apiKey) {
  return value => {
    let text = String(value);
    if (apiKey) text = text.split(apiKey).join('[REDACTED]');
    return text.replace(/sk-[\w-]+|AIza[\w-]+/g, '[REDACTED]');
  };
}

export const ownerContact = 'Contact Project Owner Adarsh Jatti\nEmail: adarshjatti@gmail.com\nPhone: 6361598124';
export function apiFailure({ status, code, type, message, model, apiKey }) {
  const clean = redactor(apiKey);
  const safeMessage = clean(message || 'The provider did not return a detailed error message.')
    .replace(/\/(?:Users|home|var|private)\/[^\s"']+/g, '[internal path]');
  const detail = `${code || ''} ${type || ''} ${safeMessage}`.toLowerCase();
  let reason = 'The AI provider rejected the request.';
  if (/insufficient_quota|billing|credit|usage_limit|quota_exceeded/.test(detail)) reason = 'The provider reported a quota or billing limit. The API does not confirm an exact remaining credit balance.';
  else if (status === 429) reason = 'The AI provider rate limit was reached.';
  else if (status === 401) reason = 'The AI API key was rejected.';
  else if (status === 403) reason = 'The AI provider denied access to this request.';
  else if (status === 404) reason = 'The requested AI model or endpoint is unavailable to this project.';
  else if (status >= 500) reason = 'The AI provider encountered a service error.';
  return Object.assign(new Error(clean(`OpenAI${status ? ` HTTP ${status}` : ''}${code ? ` (${code})` : ''}: ${safeMessage}`)), {
    isModelApiError: true, provider: 'OpenAI', httpStatus: status, providerCode: code,
    publicMessage: clean(`${reason}\nModel: ${model || 'not reported'}\n${status ? `HTTP status: ${status}\n` : ''}${code ? `Provider code: ${code}\n` : ''}Provider message: ${safeMessage}\nNo automatic retry was made.\n\n${ownerContact}`),
  });
}

export function createOpenAIRequest(apiKey, progress = console.log) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY (or AI_API_KEY).');
  return async body => {
    const started = Date.now();
    const heartbeat = setInterval(() => progress(`Still waiting for ${body.model}: ${Math.round((Date.now() - started) / 1000)} seconds…`), 30_000);
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw apiFailure({ status: response.status, code: result?.error?.code, type: result?.error?.type,
        message: result?.error?.message, model: body.model, apiKey });
      if (!result) throw apiFailure({ message: 'The AI provider returned an invalid JSON response.', model: body.model, apiKey });
      return result;
    } catch (error) {
      if (error.isModelApiError) throw error;
      throw apiFailure({ code: error.name === 'TimeoutError' ? 'request_timeout' : 'connection_error',
        message: error.name === 'TimeoutError' ? 'The request timed out. Provider-side work may still incur charges.' : 'Could not complete the connection to the AI provider.', model: body.model, apiKey });
    } finally { clearInterval(heartbeat); }
  };
}
