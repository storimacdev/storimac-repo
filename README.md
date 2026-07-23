# storimac-repo
stori mac implementation

## SDOS — Story Development Interview System

- `system-prompts/` — reference/persona documents: `sp02-character-development-reference-manual#.md` (the CDRM Project 2 is built on), `sp03-story-structural-architectu-framework.md` (the framework Project 4 is built on). Project 1's system prompt lives inside `web/system-prompts/` instead (see below) — the running app needs it, so it's self-contained inside the deployable project rather than a sibling folder.
- `ARCHITECTURE.md` — how the pipeline maps to one shared app: the Canon Engine, the data-flow contract between projects, tech stack, and open follow-ups.
- `web/` — Next.js app: landing page → `/onboarding` (Typeform-style workspace setup, issue #88) → `/interview`, a real chat-based Story Foundation interview wired to Claude.
- Product spec PRDs are **not** in this repo — they're planning docs, not needed to build/run the app. Kept locally only (see project notes for the current path).

### Run it locally

```
cd web
npm install
cp .env.local.example .env.local   # then paste your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000 — the **Get Started** button opens `/onboarding`, then continues to the real interview at `/interview`, which calls Claude with the verbatim SDOS system prompt from `web/system-prompts/sp01-sdos-systemprompt.md`.

This is a first walking-skeleton build (roughly GitHub milestone M1 — Core interview loop): the system prompt drives the conversation turn by turn, but there's no canon/state tracking, stage gating, or persistence yet (see the M2+ issues for that layer).

### Deploying

Target stack (decided 2026-07-23, see `ARCHITECTURE.md` §4/§6): Firebase App Hosting for the app itself, Firebase Auth, Firestore, Firebase Storage for binary exports. No Python/FastAPI.

**Firebase App Hosting** (the only supported path — App Hosting builds with Google Cloud Buildpacks only, confirmed against the docs; it does not support a custom Dockerfile):

```
firebase apphosting:backends:create --backend storimac-web --primary-region us-central1 --root-dir web --non-interactive
firebase apphosting:secrets:set anthropic-api-key
```

Then connect the backend to this GitHub repo via the Firebase Console (App Hosting → backend → Connect a repository) — no CLI equivalent for this step. Deploy branch `main`, root directory `web`.

`web/apphosting.yaml` configures the runtime env/secrets. **The app is self-contained inside `web/`** — no build step depends on anything outside that folder. This is deliberate: an earlier version synced `system-prompts/sp01` in from a sibling directory via a prebuild script, and App Hosting's buildpack detection (`google.nodejs.runtime`) failed against that layout. Don't reintroduce a cross-directory build dependency.

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

The Firestore data model (collections, the `array-contains` dependency-query pattern Projects 3/4 need) is documented in `ARCHITECTURE.md` §6 — the rules/indexes here implement that design, but the actual persistence feature (issue #12) isn't built yet; this is deploy scaffolding, not the finished data layer.
