# storimac-repo
stori mac implementation

## SDOS — Story Development Interview System

- `storimac-prds/` — product specs for all 5 projects in the pipeline: `prd1-storimac-foundation-prd.md`, `prd2-character-development-consultant.md`, `prd3-world-bible-development.md`, `prd4-story-architecture-framework.md`, `prd5-cycle-of-stories.md`.
- `system-prompts/` — the authoritative reference/persona documents each PRD is built on: `sp01-sdos-systemprompt.md` (Project 1's system prompt), `sp02-character-development-reference-manual#.md` (the CDRM Project 2 is built on), `sp03-story-structural-architectu-framework.md` (the framework Project 4 is built on). Projects 3 and 5 have no separate system-prompt document — their persona/rules live entirely in their own PRD.
- `ARCHITECTURE.md` — how the 5 PRDs map to one shared app: the Canon Engine, the data-flow contract between projects, tech stack, and open follow-ups.
- `web/` — Next.js app: landing page → `/onboarding` (Typeform-style workspace setup, issue #88) → `/interview`, a real chat-based Story Foundation interview wired to Claude.

### Run it locally

```
cd web
npm install
cp .env.local.example .env.local   # then paste your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000 — the **Get Started** button opens `/onboarding`, then continues to the real interview at `/interview`, which calls Claude with the verbatim SDOS system prompt from `system-prompts/sp01-sdos-systemprompt.md`.

This is a first walking-skeleton build (roughly GitHub milestone M1 — Core interview loop): the system prompt drives the conversation turn by turn, but there's no canon/state tracking, stage gating, or persistence yet (see the M2+ issues for that layer).

### Deploying

Target stack (decided 2026-07-23, see `ARCHITECTURE.md` §4/§6): Firebase App Hosting for the app itself, Firebase Auth, Firestore, Firebase Storage for binary exports. No Python/FastAPI.

**Primary path — Firebase App Hosting** (auto-builds from the repo, no Docker step):

```
firebase init apphosting          # from repo root, first time only
firebase apphosting:secrets:set anthropic-api-key
git push                          # App Hosting deploys on push once connected
```

`web/apphosting.yaml` configures the runtime env/secrets. **Unverified, check on first deploy:** this repo has `system-prompts/` as a sibling of `web/`, and the build's `prebuild` hook (`scripts/sync-system-prompts.mjs`) needs to read it — confirm App Hosting's build checks out the full repo rather than just the configured `web/` root. If it doesn't, fall back to the Dockerfile below by pointing App Hosting at a custom Docker build instead of buildpack auto-detection.

**Fallback path — manual Cloud Run**, using the Dockerfile directly (build context must be the repo root, not `web/`, since the build needs both `web/` and `system-prompts/`):

```
docker build -f web/Dockerfile -t storimac-web .
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
