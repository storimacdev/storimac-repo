# storimac-repo
stori mac implementation

## StoriMac — Story Development Interview System

StoriMac is one connected web app (not five separate tools): an author works through a pipeline of chat-based sessions — Story Foundation → Character Bible → World Bible → Screenplay Architecture → Draft Writing — each consuming the prior stage's machine-readable JSON export. All five share a single Next.js codebase (`web/`), a single Firestore database, Firebase Auth, and one **Canon Engine** (chat UI + side panel → per-element canon state machine → conflict resolution → scope-boundary guardrails → deterministic document compiler → session persistence) that each project configures rather than reimplements. See `ARCHITECTURE.md` for the full design, the data-flow contract between projects, and the Firestore data model.

Current build state per project (as of this writing):

- **Project 1 — Story Foundation** (`/interview`, `/dashboard`, `/(nocturne)/onboarding`): complete. Real chat-based interview wired to Claude, full canon state tracking, stage gating, Firestore persistence, multi-project workspace dashboard, `.md`/`.json` export.
- **Project 2 — Character Bible** (`/character-bible`, `api/character-chat`): in progress, core canon engine + chat loop built.
- **Project 3 — World Bible** (`/world-bible`, `api/world-chat`): in progress, core canon engine + chat loop built.
- **Project 4 — Screenplay Architecture** (`/story-architecture`, `api/architecture-chat`): in progress — compiler, pre-compilation audits, scene density/thematic-anchor checks, and the Screenplay Architecture Document export are built and unit-tested (see `web/src/lib/storyArchitectureEngine/`).
- **Project 5 — Draft Writing**: not yet built. Spec is an in-app, chat-based, scene-by-scene screenplay drafting session sharing the same Canon Engine pattern as Projects 1–4 (see issues #92–102).

Auth and persistence are real: Firebase Auth gates every project route, Firestore holds canon state (`web/src/lib/canonEngine/`, `characterEngine/`, `worldEngine/`, `storyArchitectureEngine/`, `workspace/workspaceStore.ts`), and `.docx`/PDF export goes through `web/src/lib/docx/` and `web/src/lib/pdf/`. The Anthropic API (`@anthropic-ai/sdk`) powers every chat turn, gated by a rate-limit guard (`web/src/lib/rateLimit/anthropicGate.ts`) that retries through Anthropic's own RPM/ITPM/OTPM limits rather than failing a turn outright.

- `system-prompts/` — reference/persona documents: `sp02-character-development-reference-manual#.md` (the CDRM Project 2 is built on), `sp03-story-structural-architectu-framework.md` (the framework Project 4 is built on). Project 1's system prompt lives inside `web/system-prompts/` instead (see below) — the running app needs it, so it's self-contained inside the deployable project rather than a sibling folder.
- `ARCHITECTURE.md` — how the pipeline maps to one shared app: the Canon Engine, the data-flow contract between projects, tech stack, and open follow-ups.
- `web/` — the Next.js app described above.
- Product spec PRDs are **not** in this repo — they're planning docs, not needed to build/run the app. Kept locally only (see project notes for the current path).

### Run it locally

```
cd web
npm install
cp .env.local.example .env.local   # then paste your ANTHROPIC_API_KEY and Firebase config
npm run dev
```

Open http://localhost:3000. Sign in (Firebase Auth), then work through the project dashboard — Story Foundation first, then Character Bible / World Bible / Screenplay Architecture once a Story has a Foundation export.

### Tests

```
cd web
npm run test          # Vitest unit suite — Canon Engine logic, P4's deterministic compiler/audit checks. No mocks of Firestore/Anthropic; pure-function coverage only.
npm run test:rules:emulators   # Firebase security-rules tests (Firestore + Storage) against the real emulator — see "Security rules" below.
```

CI (`.github/workflows/ci.yml`) runs `lint`, `build`, and `test` on every PR against `main` and on push to `main`.

### Security rules

`storage.rules`' cross-service `firestore.get()` ownership check (a story's `/exports/**` are only readable/writable by that story's `ownerUid`) is verified against the real Firebase emulator in `web/src/lib/security/storageRules.emulator.test.ts`. Run it with:

```
npm run test:rules:emulators   # from web/ — wraps the test in `firebase emulators:exec --only firestore,storage`
```

This requires the Firebase CLI (`firebase-tools`) and a Java runtime (used by the Firestore/Storage emulators) to be installed locally; it is not part of the default `npm run test` run.

### Deploying

Target stack (decided 2026-07-23, see `ARCHITECTURE.md` §4/§6): Firebase App Hosting for the app itself, Firebase Auth, Firestore, Firebase Storage for binary exports. No Python/FastAPI.

**Firebase App Hosting** (the only supported path — App Hosting builds with Google Cloud Buildpacks only, confirmed against the docs; it does not support a custom Dockerfile):

```
firebase apphosting:backends:create --backend storimac-web --primary-region us-central1 --root-dir web --non-interactive
firebase apphosting:secrets:set anthropic-api-key
```

Then connect the backend to this GitHub repo via the Firebase Console (App Hosting → backend → Connect a repository) — no CLI equivalent for this step. Deploy branch `main`, root directory `web`.

`web/apphosting.yaml` configures the runtime env/secrets, including an explicit `runConfig.timeoutSeconds` comfortable above the worst-case single chat-turn latency (two gated Anthropic-call attempts plus two full model calls). **The app is self-contained inside `web/`** — no build step depends on anything outside that folder. This is deliberate: an earlier version synced `system-prompts/sp01` in from a sibling directory via a prebuild script, and App Hosting's buildpack detection (`google.nodejs.runtime`) failed against that layout. Don't reintroduce a cross-directory build dependency.

**Manual Cloud Run** (`web/Dockerfile`, not usable via App Hosting — see above — but works for a plain Cloud Run deploy outside App Hosting):

```
cd web
docker build -t storimac-web .
gcloud run deploy storimac-web \
  --image storimac-web \
  --set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --region us-central1
```

**Firestore/Storage rules and indexes** (`firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json` — all at the repo root):

```
firebase deploy --only firestore,storage
```

The Firestore data model (collections, the `array-contains` dependency-query pattern Projects 3/4 need) is documented in `ARCHITECTURE.md` §6; the rules/indexes here implement that design and are live — persistence (issue #12) has been built for a while, this isn't just deploy scaffolding.

### Still open (tracked under issue #103)

- Error monitoring / alerting (Sentry or similar) — needs a real third-party account and API key, not something that can be wired up without that access.
- Tuning the Anthropic rate-limit gate's env vars to this account's real Anthropic Console tier limits — needs the Anthropic Console dashboard.
