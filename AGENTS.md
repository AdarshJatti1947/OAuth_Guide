# Repository Guidelines

## Maintaining This Guide

When the user runs `/init`, refresh this existing file to reflect the repository’s current structure, commands, and conventions. Preserve applicable user preferences and security rules. This convention guides agent behavior; it does not configure the application's built-in slash command.

## Project Structure & Module Organization

This repository currently implements a three-stage OAuth research CLI; the developer website is not built yet.

- `test-ai.mjs`: command-line entry, API transport, progress, and artifact saving.
- `lib/pipeline.mjs`: input analysis, research, validation/repair, schemas, and evidence checks.
- `lib/prompts.mjs`: agent instructions and assignment coverage requirements.
- `tests/pipeline.test.mjs`: offline orchestration tests.
- `AI-TEST.md`: configuration and execution instructions.
- `FLOW-VERIFICATION.md`: implementation audit and verification limits.
- `runs/`: generated research, guides, audits, and usage; ignored by Git.

## Build, Test, and Development Commands

Use Node.js 20.6+. No dependencies or build step are required.

```sh
node --check test-ai.mjs
node --test tests/pipeline.test.mjs
node --env-file=.env test-ai.mjs "How do users connect Gmail to my assistant?"
```

The first two commands are offline checks. The third runs paid research and saves artifacts. Pass the complete developer question.

## Coding Style & Naming Conventions

Use ES modules (`.mjs`), two-space indentation, single quotes, semicolons, camelCase identifiers, and uppercase snake_case environment variables. Prefer native Node APIs. No formatter or linter is configured.

## Testing Guidelines

Use Node’s built-in test runner and `*.test.mjs` filenames. Mock model responses with fake credentials. Cover stage handoffs, ambiguity, missing evidence, repair rounds, source restrictions, and failures. No coverage percentage is mandated. Offline tests do not establish model accuracy; distinguish documentation research from real setup attempts.

## Commit & Pull Request Guidelines

No Git history was available during initial inspection. Use imperative messages such as `Add validator repair checks`. Describe behavior changes, validation, cost implications, and limitations; include screenshots for future UI changes.

## Security & Configuration

Never read, display, or modify the user's `.env`; the user manages it. Never commit credentials. The pipeline currently supports OpenAI: `ANALYSER_MODEL` selects input analysis; `RESEARCH_MODEL` selects both research and validation. `AI_API_KEY` overrides `OPENAI_API_KEY`. Preserve redaction, bounded searches, timeouts, saved evidence, and explicit uncertainty. Do not silently retry paid requests or switch providers.
