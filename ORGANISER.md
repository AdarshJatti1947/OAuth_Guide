# Organiser agent

The fourth agent structures the validator's final report for the approved guide UI. It uses `ORGANISER_MODEL` (default `gpt-5.4-mini`), low reasoning, strict JSON-schema output, and no tools. It does not search, retry automatically, or write to a database. The backend validates and saves the result.

## Reuse the existing Gmail report

Keep your key and `ORGANISER_MODEL=gpt-5.4-mini` in your private `.env`. Run:

```sh
node --env-file=.env organise-guide.mjs \
  --from runs/2026-10-21T17-09-49-495Z-2d6136e4/validation.json \
  --prompt "What must I configure with Google before people can connect Gmail to my assistant, and what could delay my launch?"
```

Only one paid Organiser request runs. Input analysis, research, and validation do not rerun. Older reports did not store the original question, so supply it explicitly. New pipeline reports save `original_request` and do not require `--prompt`.

Outputs are written to a new `organised-<timestamp>-<id>/guide.json` folder beside the report. Existing artifacts are never overwritten. Each result includes:

- Exact original prompt, identity, title, subtitle, and overview metrics.
- Eight ordered sections: overview, prerequisites, setup, cases, approval, connection, next actions, and sources.
- Paragraphs, checklists, numbered steps, comparison tables, expandable details, and source IDs.
- A source catalog resolved by backend code, preserving retrieval/review metadata.
- Original validator Markdown and verbatim coverage, corrections, caveats, and warnings, attached by code rather than regenerated.
- Organiser model, token usage, and timestamp.

The full `test-ai.mjs` command now runs the Organiser after successful validation, including when the result needs review. Clarification and failed research stop before organisation. `needs_review` is preserved internally; future UI can place verification notes in the relevant sections instead of a prominent badge.

## Checks and limits

```sh
node --test tests/*.test.mjs
node --check organise-guide.mjs
```

Local checks reject malformed structures, missing/duplicate/out-of-order sections, inconsistent tables, invented source IDs, and new or forbidden URLs. They do not prove that paraphrases preserve every claim. Original content and caveats remain available to compare; review the first live result for omissions or changed meaning. Schema conformance does not imply factual correctness.

No database or web renderer is connected yet. The JSON is the storage/rendering contract for the next implementation step. No live API request was made while implementing this agent.
