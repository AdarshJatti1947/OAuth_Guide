# OAuth Guide

A developer-facing OAuth setup and approval navigator. Describe an integration, and a four-agent pipeline researches the provider, checks requirements, and creates a persistent, shareable guide.

**Live application:** https://3.26.80.160

## The problem

Registering an OAuth app with a provider is different from an end user connecting an account. A working development connection also does not establish readiness for public launch. OAuth Guide helps developers understand that path: configuration, scopes, distribution scenarios, review requirements, effort, waiting time, blockers, and the next action.

## Try it

Enter a product name, website, or complete integration question. For example:

> How do I let customers connect Slack to my AI assistant to read channel messages and post summaries? What setup, permissions, and approvals are needed?

The homepage shows the current stage, elapsed time, and backend activity. Ambiguous requests produce a clarification question below the same input. Completed guides open in a new tab at `/guides/<product>-<unique-id>` and include the original question. Opening an existing guide does not rerun the agents.

Generating a new guide uses paid OpenAI API calls and may take several minutes. The successful Slack deployment test took approximately eight minutes; this is an observation, not a completion-time guarantee.

## Run locally

Requires **Node.js 22.13+** with built-in `node:sqlite`. There are no npm dependencies or build steps. Node 22 may print an experimental SQLite warning.

From the repository root:

```sh
cp .env.example .env
```

Edit `.env` privately and replace the API-key placeholder. The selected models and hosted web-search tool must be available to your API project. Then run:

```sh
node --env-file=.env server.mjs
```

Open http://localhost:4174. SQLite tables are created automatically. A fresh clone starts with an empty guide library because databases and generated artifacts are not committed.

For browsing saved guides without enabling generation:

```sh
node server.mjs
```

## How the agents work

| Stage | Default model | Responsibility |
|---|---|---|
| Input-analyser | `gpt-4.1-mini` | Extract the product, owner, capability, environment, and distribution intent; distinguish Gmail from Google or Slack from GovSlack. Ask when ambiguous. |
| Web-search | `gpt-5.5` | Broad product-specific investigation using official documentation, policies, and changelogs. Preserve sources and uncertainty. |
| Validator | Same research model | Audit thirteen coverage areas, independently search for gaps, remove unsupported material, and optionally perform a repair round. |
| Organiser | `gpt-5.4-mini` | Convert the current validator output into schema-constrained sections for the UI. No web search or database access. |

The backend checks structure and references, retains original evidence and caveats, then atomically saves the guide and completes the job. The normal website flow uses fresh output from each preceding stage; saved-result commands are development utilities only.

Default limits are 20 research tool calls and 12 validator tool calls per round, with at most two validator rounds. These are ceilings, not dollar caps or guarantees of research depth. Generation is sequential: one active job, up to three queued, and ten new jobs per rolling hour across the application.

## Product and architecture decisions

- **Focused slice:** Gmail and Slack exercise scope sensitivity, distribution, and approval differences. This is not a prebuilt 100-app catalog; unfamiliar providers are investigated live.
- **Evidence before presentation:** distinguish facts, estimates, unknowns, and documentation research from actual setup attempts. Consumer social content and unofficial tutorials are prohibited by research instructions; domain filters and local URL checks provide additional controls.
- **Structured guides:** steps, checklists, case tables, references, and next actions render consistently. The Organiser cannot overwrite the original validator text or verbatim audit notes.
- **SQLite on one instance:** only `jobs` and `guides` tables. Intermediate outputs and usage remain in `runs/<job-id>/` files. No `agent_runs` table or separate database service.
- **Asynchronous generation:** HTTP submission returns a job ID immediately; the browser polls and remembers it across refreshes. Server restarts interrupt unfinished jobs rather than automatically repeat paid work.

## Validation findings

Early Slack drafts confused app registration with Marketplace listing, treated refresh tokens as unconditional, and supplied insufficiently supported scope/timing guidance. This led to product-boundary instructions, conditional case analysis, source reviews, and a validator repair round.

Gmail checks against official Google documentation supported scope classifications, conditional security-assessment obligations, and provider-published verification estimates. Provenance checks initially mistook OAuth scope identifiers for citations and omitted page-open records; those bugs were corrected. One missing Google reference was checked separately and recorded as supplemental evidence.

**No authenticated provider registration, real Gmail/Slack OAuth connection, or approval submission was performed.** Research and model review are not independent proof of every claim. The full four-agent website flow, SQLite save, guide viewing, and sharing were exercised on AWS with Slack. Gmail was researched earlier and its saved validator output was used to test the Organiser separately.

Run offline tests without credentials or API charges:

```sh
node --test tests/*.test.mjs
```

The suite covers stage handoffs, clarification, repair rounds, provenance, source restrictions, API failures/redaction, SQLite persistence, atomic job completion, request idempotency, routing, and HTML escaping. Mocked responses test implementation behavior, not factual accuracy.

## Deployment

The application runs on a Sydney EC2 instance with Node.js, SQLite, a systemd service, and Nginx. HTTPS uses a Let's Encrypt IP-address certificate with scheduled Certbot renewal and an Nginx deploy hook; the renewal dry-run passed. CloudFront was not used because AWS declined account access.

The app binds to `127.0.0.1:4174` by default. `PORT`, `HOST`, and `DATABASE_PATH` are configurable. Place production data outside replaced release folders and back it up. Keep ports 80/443 available for the website and certificate validation. IP certificates are short-lived; renewal must remain functional, and an EC2 public-IP change requires updating the address/certificate configuration.

## Limitations

- Model access, API credits, latency, and provider outages affect generation. No automatic paid retries or fallback providers.
- Official ownership, applicability, and freshness still involve model judgments. URL provenance does not prove a cited page supports a claim; provider policy conflicts and unknowns remain visible in guide notes.
- Guides do not automatically refresh when provider requirements change.
- No user authentication, distributed worker, resumable generation after server restart, scheduled database backup, or automated uptime monitoring is implemented.
- Shared guide URLs expose their original questions. Do not submit secrets or confidential information.
- Only the OpenAI-backed pipeline is implemented. Alternative model-provider adapters are not currently supported.

## Repository map

`server.mjs` starts the website; `lib/` contains agents, transport, jobs, SQLite storage, routes and rendering; `public/` holds browser assets; `tests/` contains offline tests. `preview/` is the earlier static design prototype.

Additional instructions: [Website](WEBSITE.md), [Research CLI](AI-TEST.md), [Organiser](ORGANISER.md), and [flow audit](FLOW-VERIFICATION.md). Historical audit notes describe their verification point in time; this README summarizes the submitted implementation.

Never commit `.env`, SSH `.pem` files, SQLite databases, or unreviewed run artifacts.
