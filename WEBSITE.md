# Local OAuth guide website

## Live chat and generation

To enable live generation, stop the old server and start it with the environment loaded:

```sh
node --env-file=.env server.mjs
```

Open http://localhost:4174/. Enter the complete question in the chat-style input. Enter submits; Shift+Enter adds a line. Submitting creates a SQLite job and runs the actual flow: **input-analyser → web-search → validator (including bounded repair) → Organiser → SQLite → unique guide URL**. The website never substitutes the existing Gmail result for a new request. Merely browsing does not call a model.

Progress appears below the input. If clarification is needed, the pipeline stops before research and shows the question below the same input; submit a revised prompt to create a new job. On completion, Open guide opens a new tab and Copy link copies the guide URL. The original question appears on the shared page.

The browser remembers the current job ID and resumes polling after a refresh. Request IDs prevent identical HTTP retries from creating duplicate paid jobs. Jobs run asynchronously inside the single Node server, one at a time, with up to three queued and ten new submissions per rolling hour. These are demo safeguards, not dollar limits. No automatic model retries or saved-result fallback occurs.

Restarting the server marks unfinished jobs interrupted instead of automatically repeating paid work. The current implementation is a single-process worker, not a distributed or restart-resumable queue. Completed guides persist in SQLite. Artifacts are saved under `runs/<job-id>/`. The server must remain running during generation.

Same-origin JSON submission, bounded request size, parameterized database access, and atomic guide/job completion are implemented. Production authentication and distributed workers are not included. AWS deployment remains outstanding.

The complete pipeline was exercised with mocked model responses, including automatic storage, clarification, failures and idempotency. No paid generation or real-browser interaction was run during implementation.

## Browsing saved guides

Requires Node.js 22.13+ with the built-in `node:sqlite` module. No npm dependencies are required. Node 22 may print an experimental SQLite warning.

The saved Gmail guide is imported into `data/oauth-guide.db` with the slug `gmail-guide-456`. To browse only, start without loading API credentials:

```sh
node server.mjs
```

Open http://localhost:4174/ for the saved-guide library. Select **Open guide** to open a new tab, or visit http://localhost:4174/guides/gmail-guide-456 directly. The page displays the original developer prompt and structured content using the approved guide design. Copy-link buttons copy its current URL. Localhost URLs work only on your computer; publicly shareable URLs require deployment.

This is a different server from the static mockup on port 4173. The new page reads SQLite; no agents or model calls run when viewing or importing a guide. Keep the database server running while browsing. Stop with Ctrl+C.

## Import another organised guide

```sh
node import-guide.mjs runs/<run>/<organised>/guide.display.json
```

Generated slugs include a unique identifier. An optional second argument sets a deliberate slug; duplicates fail without overwriting the existing guide. Guide structure and source references are validated before insertion. Importing a guide does not create a generation job because no generation takes place.

## Database

Only two application tables exist:

- `guides`: ID, unique slug, product, title, original prompt, complete organised JSON, internal evidence status, creation time.
- `jobs`: ID, prompt, status, agent stage, resulting guide ID, clarification/error, timestamps. Used by the background worker and progress API.

Intermediate agent runs remain in files. Foreign keys connect completed jobs to guides. Parameterized statements protect database queries. WAL mode allows readers alongside writes.

## AWS configuration

Set `DATABASE_PATH` to a persistent EBS-backed path outside deployment releases, such as `/var/lib/oauth-guide/app.db`. Set `PORT` as needed. Default binding is loopback; use an HTTPS reverse proxy on the AWS instance. No deployment has been performed yet.

Back up SQLite using its backup facilities or stop the app and copy the complete database state, including any active WAL; copying only an actively written `.db` file is not a reliable backup. The `data/` directory and SQLite files are ignored by Git.

## Verification

```sh
node --test tests/*.test.mjs
node --check server.mjs
```

Tests cover real SQLite persistence, unique slugs, job references, route responses, HTML escaping, and blocked filesystem access. Guide output is escaped, links accept only HTTP(S), and only explicit CSS/JS assets are served. No prominent evidence-status banner is displayed; contextual source and uncertainty notes remain.

Browser visuals and actual clipboard/new-tab behavior require checking in your browser; offline route checks do not automate those interactions. AWS deployment is the next infrastructure stage after local acceptance.
