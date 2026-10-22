# Three-agent flow verification

This is an offline implementation audit, not a live model-quality evaluation.

| Requested behavior | Implementation | Evidence |
|---|---|---|
| Analyse the entire question | Original input goes unchanged to the analyser | Handoff test checks exact equality |
| Distinguish product from organization | Structured product/organization/environment fields and explicit sibling-product instructions | Gmail/Google fixture, ambiguity-stop test |
| Lightweight first agent | Default `gpt-4.1-mini` | Configuration and request assertions |
| Broad, product-specific research | Original request plus extracted identity, exclusions and intent passed to research | Handoff test |
| More research and output | Default 20 research tool calls, 16,000 output tokens, high reasoning | Configuration; ceilings do not force consumption |
| Preserve sources | Research dossier, source inventory, citation flags, search actions and usage saved | Artifact assertions |
| Same model for research and validator | Both use the same configured research model | Request model equality assertions |
| Validator searches independently | Search tool required on each validator round | No-search warning and repair tests |
| Research missing requirements again | Previous audit and unresolved coverage feed a bounded repair round | Four-request repair test |
| Remove irrelevant information from both stages | Validator instructions require removal and structured corrections/removals | Mechanism implemented; semantic quality requires live evaluation |
| Assignment coverage | Thirteen required areas including difficulty, approvals, effort/waits and human handoffs | Missing/unknown requirement tests |
| Official, current, applicable evidence | Validator source reviews plus local inventory and applicability checks | Negative source-review and fabricated-evidence tests |
| Final tuned guide | Markdown guide plus coverage audit, corrections, uncertainty and JSON provenance | Artifact assertions |

## Corrections made during audit

Added explicit difficulty coverage, per-source official/applicable/current judgments, guide-link evidence checks, and one bounded validator repair round by default. Remaining uncertainty now prevents `model_reviewed` status. Each validator round is saved separately.

## Limits of verification

Twelve mocked tests and syntax checks pass without credentials or network calls. Fixtures exercise orchestration; they do not prove that a model will correctly identify Gmail or faithfully remove irrelevant claims. Source-review judgments remain model judgments. Search filters cannot prove universal official-only retrieval or freshness. A stronger model and a second review do not eliminate hallucinations.

No paid live run was made during this audit. Model availability, search/schema compatibility for the selected account, actual research depth, cost and factual quality remain to be tested live. This pipeline investigates public documentation; authenticated provider setup attempts and the website remain outside this implementation.
