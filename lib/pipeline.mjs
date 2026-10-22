import { analyserInstructions, researchInstructions, validatorInstructions, requirements } from './prompts.mjs';

const string = { type: 'string' };
const strings = { type: 'array', items: string };
function object(properties) {
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}
export const identitySchema = object({
  product: string, organization: string, environment: string, capability: string,
  distribution: string, identity_notes: string, excluded_products: strings,
  official_domains: strings, needs_clarification: { type: 'boolean' }, clarification_question: string,
});
export const validationSchema = object({
  guide_markdown: string, corrections: strings, removed_details: strings, uncertainties: strings,
  source_reviews: { type: 'array', items: object({ url: string, official: { type: 'boolean' },
    applicable: { type: 'boolean' }, current: { type: 'boolean' }, explanation: string }) },
  coverage: { type: 'array', items: object({
    requirement: { type: 'string', enum: requirements },
    status: { type: 'string', enum: ['supported', 'unknown', 'not_applicable'] },
    explanation: string, evidence_urls: strings,
  }) },
});
export const blockedDomains = [
  'reddit.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com',
];
// Do not block facebook.com at tool level: subdomain blocking would also exclude
// official Meta developer documentation. Consumer URLs are rejected locally.
const searchBlockedDomains = blockedDomains.filter(d => d !== 'facebook.com');
export function openedSources(searches) {
  return searches.filter(s => s.status === 'completed' && ['open_page', 'find_in_page'].includes(s.action?.type)
    && s.action.url && !forbiddenUrl(s.action.url)).map(s => ({ url: s.action.url, title: 'Opened official-candidate page', cited: false, provenance: s.action.type }));
}
export function evidenceUrls(markdown) {
  // Code contains configuration values and endpoints, not documentary citations.
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/(`+)[\s\S]*?\1/g, '');
  return [...new Set((prose.match(/https?:\/\/[^\s<>"\])`]+/g) || []).map(url => url.replace(/[.,;]+$/, '')))];
}
export function forbiddenUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return true;
    const host = url.hostname.toLowerCase();
    if (host === 'developers.facebook.com') return false;
    return blockedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return true; }
}
export function parseResponse(result) {
  if (result.status !== 'completed') throw new Error(`Response incomplete: ${result.status}; ${result.incomplete_details?.reason || 'no reason returned'}`);
  const output = result.output || [];
  const parts = output.filter(p => p.type === 'message').flatMap(p => p.content || []);
  if (parts.some(p => p.type === 'refusal')) throw new Error('The model declined this request.');
  const text = parts.filter(p => p.type === 'output_text').map(p => p.text).join('\n');
  if (!text) throw new Error('No answer returned.');
  const searches = output.filter(p => p.type === 'web_search_call');
  const sources = new Map();
  for (const part of parts) for (const citation of part.annotations || []) {
    if (citation.type === 'url_citation' && !forbiddenUrl(citation.url)) {
      sources.set(citation.url, { url: citation.url, title: citation.title || 'Cited source', cited: true });
    }
  }
  for (const search of searches) for (const source of search.action?.sources || []) {
    if (source.url && !forbiddenUrl(source.url) && !sources.has(source.url)) {
      sources.set(source.url, { url: source.url, title: source.title || 'Retrieved source', cited: false });
    }
  }
  for (const source of openedSources(searches)) if (!sources.has(source.url)) sources.set(source.url, source);
  return { text, sources: [...sources.values()], searches: searches.map(p => ({ status: p.status, action: p.action })), usage: result.usage || {} };
}
export function auditCoverage(validation, sources) {
  const warnings = [];
  const known = new Set(sources.map(s => canonicalUrl(s.url)));
  const accepted = new Set((validation.source_reviews || []).filter(s => s.official && s.applicable && s.current && s.explanation.trim()).map(s => canonicalUrl(s.url)));
  for (const requirement of requirements) {
    const entries = validation.coverage.filter(c => c.requirement === requirement);
    if (entries.length !== 1) { warnings.push(`Expected exactly one coverage entry for ${requirement}.`); continue; }
    const entry = entries[0];
    if (!entry.explanation.trim()) warnings.push(`Missing explanation for ${requirement}.`);
    if (entry.status === 'supported' && (!entry.evidence_urls.length || entry.evidence_urls.some(url => forbiddenUrl(url) || !known.has(canonicalUrl(url))))) {
      warnings.push(`Evidence not found in retrieved source inventory for ${requirement}.`);
    }
    if (entry.status === 'supported' && entry.evidence_urls.some(url => !accepted.has(canonicalUrl(url)))) {
      warnings.push(`Evidence lacks an official, applicable, current source review for ${requirement}.`);
    }
  }
  const guideUrls = evidenceUrls(validation.guide_markdown);
  for (const url of guideUrls) {
    if (forbiddenUrl(url)) warnings.push('Final guide contains a forbidden source URL.');
    else if (!known.has(canonicalUrl(url)) || !accepted.has(canonicalUrl(url))) warnings.push(`Guide URL lacks retrieved and reviewed evidence: ${url}`);
  }
  return warnings;
}
export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
      // Known navigation/tracking variants; retain language and functional parameters.
      if (url.hostname === 'support.google.com' && key === 'ref_topic') url.searchParams.delete(key);
      if (url.hostname === 'developers.google.com' && url.pathname === '/terms/api-services-user-data-policy' && key === 'recordId') url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  }
  catch { return value; }
}
export function configuration(env) {
  function integer(name, fallback, max) {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer between 1 and ${max}.`);
    return value;
  }
  if (env.AI_PROVIDER && env.AI_PROVIDER !== 'openai') throw new Error('The three-stage pipeline currently supports OpenAI only; it will not silently switch providers.');
  return {
    analyserModel: env.ANALYSER_MODEL || 'gpt-4.1-mini',
    researchModel: env.RESEARCH_MODEL || 'gpt-5.5',
    searchCalls: integer('RESEARCH_MAX_TOOL_CALLS', 20, 100),
    validatorCalls: integer('VALIDATOR_MAX_TOOL_CALLS', 12, 100),
    validatorRounds: integer('VALIDATOR_MAX_ROUNDS', 2, 3),
    outputTokens: integer('RESEARCH_MAX_OUTPUT_TOKENS', 16000, 64000),
    reasoning: env.RESEARCH_REASONING || 'high',
  };
}
export async function runPipeline({ prompt, config, request, save = async () => {}, progress = () => {}, onStage = () => {} }) {
  onStage('input_analyser');
  progress('1/4 Input-analyser: identifying the exact product…');
  const analysis = parseResponse(await request({ model: config.analyserModel, store: false, max_output_tokens: 2500,
    instructions: analyserInstructions, input: prompt,
    text: { format: { type: 'json_schema', name: 'product_identity', strict: true, schema: identitySchema } },
  }));
  const identity = JSON.parse(analysis.text);
  await save('identity.json', identity);
  await save('analysis-usage.json', analysis.usage);
  if (identity.needs_clarification) return { status: 'needs_clarification', identity };
  if (!identity.product.trim() || !identity.organization.trim()) throw new Error('Analyser returned an empty product or organization.');
  progress(`Identified ${identity.product} (${identity.organization}); ${identity.identity_notes}`);
  // Official domains are proposed by the analyser, not trusted as proof of ownership.
  const tool = { type: 'web_search', external_web_access: true, filters: { blocked_domains: searchBlockedDomains } };
  const shared = { model: config.researchModel, store: false, reasoning: { effort: config.reasoning },
    max_output_tokens: config.outputTokens, tools: [tool], tool_choice: 'required', include: ['web_search_call.action.sources'] };
  progress('2/4 Web-search: investigating official setup and approval requirements…');
  onStage('web_search');
  const research = parseResponse(await request({ ...shared, max_tool_calls: config.searchCalls,
    instructions: researchInstructions(), input: JSON.stringify({ original_request: prompt, product_identity: identity }) }));
  await save('research.md', research.text);
  await save('research-evidence.json', { sources: research.sources, searches: research.searches, usage: research.usage });
  if (!research.sources.length || !research.searches.some(s => s.status === 'completed')) throw new Error('Research returned no usable search evidence. Draft saved; validation stopped.');
  progress('3/4 Validator: checking coverage, researching gaps, and correcting the guide…');
  onStage('validator');
  let validation;
  let warnings;
  let sources = [...research.sources];
  const rounds = [];
  for (let round = 1; round <= (config.validatorRounds || 1); round++) {
    if (round > 1) progress(`Validator repair round ${round}: searching for unresolved requirements and evidence…`);
    const reviewed = parseResponse(await request({ ...shared, max_tool_calls: config.validatorCalls,
      instructions: validatorInstructions(), input: JSON.stringify({ original_request: prompt, identity,
        research_dossier: research.text, sources, previous_validation: validation || null,
        repair_targets: warnings || [], unresolved_requirements: validation?.coverage.filter(c => c.status === 'unknown') || [],
      }),
      text: { format: { type: 'json_schema', name: 'validated_guide', strict: true, schema: validationSchema } },
    }));
    validation = JSON.parse(reviewed.text);
    if (!validation.guide_markdown.trim()) throw new Error('Validator returned an empty guide. Research artifacts were retained.');
    sources = [...sources, ...reviewed.sources];
    warnings = auditCoverage(validation, sources);
    if (!reviewed.searches.some(s => s.status === 'completed')) warnings.push('Validator returned no independent completed web search.');
    rounds.push({ round, validation, warnings, searches: reviewed.searches, usage: reviewed.usage });
    await save(`validator-round-${round}.json`, rounds.at(-1));
    if (!warnings.length && !validation.coverage.some(c => c.status === 'unknown') && !validation.uncertainties.length) break;
  }
  const unresolved = validation.coverage.filter(c => c.status === 'unknown').map(c => c.requirement);
  const status = warnings.length || unresolved.length || validation.uncertainties.length ? 'needs_review' : 'model_reviewed';
  const report = { status, original_request: prompt, identity, validation, warnings, unresolved,
    models: { analyser: config.analyserModel, research: config.researchModel, validator: config.researchModel },
    sources, validator_rounds: rounds, usage: { analyser: analysis.usage, research: research.usage, validator: rounds.map(r => r.usage) } };
  await save('validation.json', report);
  const notice = `> Status: ${status}. Model-reviewed documentation research; no provider setup or connection was tested.\n\n`;
  const audit = '\n\n## Validation audit\n\n' + validation.coverage.map(c =>
    `- **${c.requirement}: ${c.status}.** ${c.explanation} ${c.evidence_urls.map(url => `[Evidence](${url})`).join(' ')}`
  ).join('\n');
  const changes = '\n\n## Corrections and removed details\n\n' + [...validation.corrections, ...validation.removed_details].map(c => `- ${c}`).join('\n');
  const unknowns = '\n\n## Remaining uncertainty and audit warnings\n\n' +
    [...validation.uncertainties, ...warnings].map(c => `- ${c}`).join('\n');
  await save('guide.md', notice + validation.guide_markdown + audit + changes + unknowns);
  return report;
}
