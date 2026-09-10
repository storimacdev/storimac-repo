# Widen SYSTEM_PROMPT_TELLS for sp03 (Issue #116) — Design

## Problem

`turnGuardrails.ts`'s `SYSTEM_PROMPT_TELLS` array is "phrases lifted from sp01/sp02" by its own header comment. Confirmed by reading `sp03-wdc-systemprompt.md`'s actual 10 numbered section headers: only two incidentally match today (`"CORE PERSONA & OBJECTIVE"`, `"STRUCTURED OUTPUT CONTRACT"` — both shared verbatim across all three prompts), and one existing entry is a near-miss that silently fails: `"CANON & SYSTEMIC CONSISTENCY MANAGEMENT"` (sp02's wording) vs. sp03's real header `"CANON & SYSTEM INTEGRITY MANAGEMENT"` — a one-word difference defeats the substring check entirely.

## Fix

Add sp03's remaining distinctive headers as their own entries (never edit or remove any existing entry), matching the existing convention (near-verbatim phrases that indicate the model is reciting its own instructions rather than conversing):

- `"ADAPTIVE WORLD COMPLEXITY & WORKFLOW"` (sp03 §2)
- `"THE WORLD DEVELOPMENT PRIORITY FRAMEWORK"` (sp03 §3)
- `"CANON & SYSTEM INTEGRITY MANAGEMENT"` (sp03 §5 — the corrected near-miss)
- `"MULTI-STAGE INTERVIEW WORKFLOW"` (sp03 §6)
- `"UNIVERSAL WORLD ENTRY MODEL"` (sp03 §7)
- `"WORLD BIBLE STRUCTURE SPECIFICATION"` (sp03 §8)

`"STRICT SCOPE BOUNDARIES & DEFERRALS"` (sp03 §4) is not added as a new entry — the existing `"STRICT SCOPE BOUNDARIES"` entry is already a substring match against it. `"OPENING TURN"` (sp03 §10) is deliberately not added — neither sp01 nor sp02's own "OPENING TURN" section header is in the list today either, and it's short/generic enough to false-positive on ordinary prose ("the opening turn of events...").

This is monitoring-only (this module's established log-only design, per issue #5/#110) — no behavior change for the author, only a real signal for future prompt-tuning review of World Bible specifically.

## Out of scope

- No change to any other array in `turnGuardrails.ts` (`INTERNAL_NARRATION_PATTERNS`, `AUTHOR_TYPE_OR_SCHEMA_LEAK_PATTERNS`, `DEVELOPER_TERMINOLOGY_PATTERNS`).
- No change to `sp03-wdc-systemprompt.md` itself.
