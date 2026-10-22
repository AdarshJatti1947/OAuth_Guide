# OAuth research and organisation pipeline

The CLI now runs a fourth Organiser stage after validation. Set `ORGANISER_MODEL=gpt-5.4-mini` to configure it. To test only the Organiser against an existing report without repeating research, follow `ORGANISER.md`. A normal full run now adds one no-search model request for organisation and saves `organised-guide.json`; validator repair rounds remain bounded separately. SQLite and the dynamic website are not connected yet.

Requires Node.js 20.6+; no packages to install. This implementation uses OpenAI. Gemini and Claude adapters are not currently implemented for the new pipeline, and unsupported providers fail explicitly.

## Configuration

Keep your existing private `OPENAI_API_KEY` in `.env`. Add or update these settings yourself:

```dotenv
AI_PROVIDER=openai
ANALYSER_MODEL=gpt-4.1-mini
RESEARCH_MODEL=gpt-5.5
RESEARCH_REASONING=high
RESEARCH_MAX_TOOL_CALLS=20
VALIDATOR_MAX_TOOL_CALLS=12
VALIDATOR_MAX_ROUNDS=2
RESEARCH_MAX_OUTPUT_TOKENS=16000
```

The validator always uses `RESEARCH_MODEL`, matching the research stage. The old `AI_MODEL` setting is no longer used. `AI_API_KEY`, if set, overrides `OPENAI_API_KEY`. Existing shell variables override `.env`. Never share or commit credentials.

GPT-4.1 mini handles focused product extraction. GPT-5.5 is the initial extended-research model because official OpenAI documentation supports it for agentic search and high-reasoning investigations. This is a documented workload fit, not a claim of measured superiority over every available model. Access and quotas depend on your project. There is no automatic fallback to a paid model.

## Run

Pass the complete developer question, not just a product name:

```sh
node --env-file=.env test-ai.mjs "What must I configure with Google before people can connect Gmail to my assistant, and what could delay my launch?"
```

Product-only input also works when unambiguous. Ambiguous input produces a clarification question and stops before research. Rerun with the clarified request.

## Stages and artifacts

1. **Input-analyser:** structured product identity, owner, capability, environment, exclusions and assumptions. Distinguishes Google from Gmail and Gmail from Google Play. Suggested official domains are unverified proposals.
2. **Web-search:** broad product-specific investigation of setup, scopes, testing, distribution cases, approval, effort/waits, blockers, handoffs and evidence.
3. **Validator:** audits all thirteen coverage areas, including difficulty, searches independently for gaps and consequential claims, removes irrelevant content, and produces a final guide with corrections and uncertainty. If requirements, evidence checks, or uncertainty remain unresolved, a bounded repair round searches again and receives the previous audit and explicit repair targets.

Timestamped folders under `runs/` contain `identity.json`, `analysis-usage.json`, `research.md`, `research-evidence.json`, `validator-round-N.json`, `validation.json`, and `guide.md`. Ambiguous/failed runs retain only completed stages. These files are ignored by Git; inspect and selectively publish sanitized guides when ready. No credentials or raw requests are saved. Public research inputs and outputs are saved locally, so do not submit secrets in prompts.

The terminal prints stage progress and a heartbeat every 30 seconds while waiting. Each request has a 15-minute timeout; a complete run may take longer. No automatic retries occur. Research search actions, opened pages and citations are preserved separately from the final guide.

## Evidence and limitations

The shared prompts require current official documents, exact product applicability, source dates when available, inline citations, conditional case analysis and explicit unknowns. Social content and forums are prohibited. Search filters block major social domains; consumer Facebook URLs are excluded locally while `developers.facebook.com` remains usable for Meta documentation. Provider documentation ownership, freshness and factual support are still model judgments, not independently proven by a URL check.

Local audit checks coverage entries, verifies that supporting URLs occurred in the retrieved inventory, and requires positive validator reviews of source ownership, product applicability, and currency. Guide links receive the same inventory/review check. It cannot prove those pages support the claims. A retrieved page is not automatically a cited or verified source. Final status is `model_reviewed` or `needs_review`, never human-verified PASS. Unknown coverage and local audit warnings produce exit code 2; API/configuration errors produce exit code 1. No actual provider registration, approval or OAuth connection is attempted by this pipeline.

## Cost and checks

A normal run has three model requests; a repair round adds one more. By default the validator has at most two rounds with twelve tool calls each; research has twenty. Set VALIDATOR_MAX_ROUNDS=1 to disable repair rounds. Research and validation may make many tool calls. The configured counts are ceilings, not quotas the agent must exhaust, and not dollar caps. Reasoning uses output tokens. Input includes the research dossier during validation. Expect higher costs than the earlier small test; inspect per-stage usage and OpenAI billing before repeated runs. A timeout may still incur charges.

Run offline checks without loading `.env` or making API calls:

```sh
node --check test-ai.mjs
node --test tests/pipeline.test.mjs
```

The mocked tests validate orchestration and failure handling, not model accuracy. The new pipeline has not yet been run against the paid API.

References: [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [pricing](https://developers.openai.com/api/docs/pricing).
