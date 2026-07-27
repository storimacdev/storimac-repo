# Landing Page Redesign — Design Spec

Date: 2026-07-27
Status: approved direction (hybrid identity, full narrative structure, animated interview hero)

## Goal

Expand the current minimal landing page (`web/src/app/(nocturne)/page.tsx`) into a full
marketing page that converts cold visitors. Audience is tiered: plain-language benefit copy
up top for aspiring writers, craft-level depth further down for working writers. There is no
social proof or public pricing yet, so the page earns credibility by **demonstrating the
product** (interview + canon locking) rather than quoting users.

## Visual identity: hybrid (Nocturne base, ember accent)

The Nocturne design system (`web/src/styles/nocturne.css`) remains the base: indigo
`#161826` background, surface cards, Libre Franklin, existing spacing/radius/shadow tokens.

Changes:

- New tokens: `--color-ember-from: #b91c1c`, `--color-ember-to: #ea580c`, and
  `--gradient-ember: linear-gradient(90deg, var(--color-ember-from), var(--color-ember-to))`.
- New `.btn-ember`: filled gradient primary button (white text, hover brightens), joining the
  existing `.btn-primary` / `.btn-secondary` / `.btn-ghost` set.
- Usage rule: violet `--color-accent` stays for links, chips, and quiet UI. **Ember is
  reserved for primary CTAs and at most one highlighted phrase per screen.** Scarcity makes
  it read as the action color.
- The site header's existing red/orange "Get started" already matches; after this change the
  site has one identity instead of two.

## Page structure & content

Replaces the body of `web/src/app/(nocturne)/page.tsx`. `SiteHeader`, `SiteFooter`, and the
state-aware `LandingCta` logic (returning users get "Continue your story") are kept.

1. **Hero.** Headline: "Turn a story idea into a locked creative foundation." (unchanged).
   Tightened subline. Ember CTA via `LandingCta`. Below the fold line: the **animated
   interview exchange** — a staged Q&A types out (editor question → writer answer → editor
   follow-up), then a canon chip flips *Exploring → Working* with a small lock-in animation,
   holds, and loops with a second Q&A pair. `prefers-reduced-motion` renders the final
   static frame instead.
2. **The problem.** Three short beats, plain language: ideas stall mid-draft; notes
   contradict each other; AI tools write *for* you instead of thinking *with* you.
3. **How it works.** Three numbered steps with small visuals: ① answer one focused question
   at a time → ② watch decisions harden into canon (Exploring / Working / Confirmed /
   Parked) → ③ lock a Story Foundation Document your drafting depends on.
4. **Product deep-dive.** Two alternating rows reusing hero-style mock components:
   - Canon panel showing a caught contradiction — "Conflicts are surfaced, never silently
     overwritten."
   - 8-stage progression bar — "A real development process, not a chat window."
5. **For serious writers.** Tiered-depth section: compact craft-level cards keeping the
   current three ("Discovery, not generation", "Canon that can't drift", "Stays in its
   lane") plus one on the 8-stage structural method. This section may use terms like
   premise, dramatic engine, canon.
6. **FAQ.** Five questions: Does the AI write my story? (no — never generates prose); Who
   owns the work?; What formats? (novel, film, TV, …); What happens after the foundation is
   locked?; Can I change a locked decision? (yes — revision with cascade review).
7. **Final CTA.** "Start your foundation" ember button + reassurance line ("Under a minute
   to set up. Your first question is waiting.").

Copy voice: confident, craft-respecting, plain first / precise later — matching the register
of the existing copy.

## Architecture

- `web/src/app/(nocturne)/page.tsx` — stays a server component; composes the section
  components in order.
- New directory `web/src/components/landing/`:
  - `HeroDemo.tsx` — client component; the animated interview exchange. Drives a scripted
    sequence with React state + CSS transitions; checks `prefers-reduced-motion` (CSS media
    query for animations, `matchMedia` for the JS sequencing) and renders the final frame
    statically when set.
  - `ProblemSection.tsx`, `HowItWorks.tsx`, `DeepDive.tsx`, `ProCards.tsx`, `Faq.tsx`,
    `FinalCta.tsx` — server components, no state.
- FAQ uses native `<details>/<summary>` — accessible, zero JS.
- `LandingCta.tsx` switches its button class to `.btn-ember` (logic unchanged).
- CSS lives in `nocturne.css`: ember tokens + `.btn-ember` in the token/component area, and
  landing-specific classes under a new `ld-` prefix section (following the existing `ob-`
  page-section convention).
- Mock product visuals (canon panel, stage bar, chat bubbles) are hand-built HTML/CSS in the
  landing components — not screenshots — so they stay crisp, themeable, and honest about
  being illustrative.
- Responsive: sections stack to single column below `sm`; the hero demo card goes
  full-width; alternating deep-dive rows collapse to visual-above-text.

## Error handling

The page is static apart from `LandingCta` (already handles guest/authed/loading states) and
the hero animation. If JS fails or is disabled, `HeroDemo` server-renders its static final
frame — no layout shift, no blank hero.

## Testing / verification

No test framework exists in `web/` (scripts: dev/build/lint only). Verification is:

- `npm run lint` and `npm run build` pass.
- Manual pass in the dev server: guest + authed CTA states, reduced-motion behavior
  (emulated via DevTools), mobile (~375px), tablet (~768px), desktop widths.

## Out of scope

- Pricing section, testimonials (no assets yet).
- Re-skinning the interview screen's gradient frame (already ember-adjacent; a later task
  may align its neutrals with Nocturne).
- SEO/meta/OG images — worth a follow-up issue.
