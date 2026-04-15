# AI Interviewer

Voice-first mock interview app for North American SDE interview prep, currently centered on coding interviews, a stage-governed AI interviewer, and an optional public interviewer persona flow.

## Current Status

This repo now has a working MVP-plus skeleton with:

- `Next.js + TypeScript` app router frontend and API routes
- `Postgres + Redis` local infra via Docker Compose
- `Prisma` data model for sessions, interviewer profiles, persona context, evaluations, and event history
- Optional interviewer profile setup flow
- `BullMQ`-backed persona ingestion queue with a worker process
- Persona queue observability in both setup UI and admin dashboard
- Interview room with transcript persistence, stage-governed assistant turns, Monaco editor, local code execution, and streaming AI replies
- Lightweight evaluation/report v0 with stage journey, replay markers, dimension scores, strengths, weaknesses, actionable improvements, and product-facing candidate profiling
- Snapshot-first report/admin pipeline with canonical candidate-state and interviewer-decision snapshots, plus shared replay evidence across report and admin
- Snapshot-first admin summary plus stage-grouped replay UI in the standalone report page
- Intent-first + trajectory-aware interviewer control path with persisted intent/trajectory snapshots and session-level critic summaries surfaced in report/admin
- Default interviewer skills layer for tone, pacing, follow-up discipline, and coaching-without-spoiling
- Browser voice loop with interruption handling, continuous listening, and turn-taking policies
- Dedicated STT handoff for spoken candidate turns, with provider selection and browser transcript fallback
- Dedicated STT-backed voice mode with provider-led turn detection, provider preview drafts, usage logging, low-cost mode controls, and switchable STT providers
- `Vitest` unit/route tests and `Playwright` end-to-end tests
- Full `Vitest` coverage is now green locally again (`198 passed / 38 files`), so test validation is part of the normal development loop rather than a blocked follow-up task.

## Recent Progress

- System design interviewer `Phase 0/1/2/3/4/5/6/7/8/9` is completed (including report radar/evidence view and whiteboard aux-only observability).
- Stage control is mode-aware, and system design includes API contract gating + on-demand capacity gating.
- Design signals (`requirements/capacity/tradeoff/SPOF/bottleneck`) are extracted with evidence refs and visible in admin snapshots.
- System design decision path is now separated from coding decision flow to avoid regressions while still reusing shared conversation-quality controls.
- Full detailed log of recent changes moved to:
  - [docs/changelog/2026-04-11-progress-archive.md](docs/changelog/2026-04-11-progress-archive.md)

## Known Limits (Short-Term)

- System design signal detection still relies on heuristic text patterns for some cases (for example nuanced handwave detection).
- System design reward/scoring is now wired into report attribution, but still uses heuristic components and should be calibrated with more real transcripts.

## Latest Interviewer Quality Upgrades

- Decision flow uses `signals + intent + trajectory + pass conditions + pacing`.
- Snapshot-first admin/report pipeline is the source of truth for replay and evidence.
- Turn quality control includes critic pass, pressure-aware decisioning, and closure semantics.
- Detailed upgrade history is archived in:
  - [docs/changelog/2026-04-11-progress-archive.md](docs/changelog/2026-04-11-progress-archive.md)

## What Works Today

### Product Flow

- `/setup`
  - Choose interview mode, level, language, company style, difficulty, and voice toggle
  - Choose whether to run in `low-cost mode`
  - Optionally paste a public interviewer profile URL
  - Analyze the profile and watch queue state move through setup UI
- `/interview/[id]`
  - Session room renders selected question and interviewer context
  - Browser speech recognition remains available as fallback
  - When a dedicated STT provider is configured, spoken candidate turns can be handled in a provider-first voice mode
  - Provider preview drafts can appear live while speaking
  - Spoken candidate turns can be re-transcribed through a dedicated STT provider before persistence, with browser transcript fallback
  - When provider-backed LLM turns fail or hit rate limits, the room can explain why the turn fell back to the local interviewer
  - AI assistant turns can be generated from recent transcript, current stage, persona context, latest code run, and policy state
  - AI replies stream into the UI over `SSE`
  - Browser TTS speaks AI replies with a queued utterance model
  - Candidate speech can interrupt AI playback and generation
  - Continuous listening mode can auto-submit candidate turns after a content-aware silence threshold
  - Room UI shows approximate LLM/STT usage counts and estimated session cost
  - Monaco editor is wired for coding sessions
  - Local sandbox execution supports Python and JavaScript today
  - Feedback report v0 can be generated in-room and reloaded from persisted session data
- `/report/[id]`
  - Shows standalone evaluation summary and recommendation
  - Displays dimension scores and actionable improvements
  - Replays key session moments such as stage transitions, signal snapshots, interviewer decisions, hint delivery, code runs, and final feedback generation
  - Shares the same candidate-state evidence backbone as `/admin`
- `/admin`
  - Inspect recent interviewer profiles
  - View raw queue job state
  - View persona pipeline events
  - View unified persona and session operations feed with readable lifecycle descriptions
  - Inspect the latest session summary, candidate state, interviewer decision, and a session-state timeline

### Backend Flow

- `POST /api/interviewer-profiles/preview`
- `POST /api/interviewer-profiles`
- `GET /api/interviewer-profiles/:id`
- `GET /api/interviewer-profiles/:id/job`
- `GET /api/interviewer-profiles/:id/events`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/assistant-turn`
- `POST /api/sessions/:id/assistant-turn/stream`
- `GET /api/sessions/:id/transcripts`
- `POST /api/sessions/:id/transcripts`
- `GET /api/sessions/:id/events`
- `POST /api/sessions/:id/events`
- `GET /api/sessions/:id/code-runs`
- `POST /api/sessions/:id/code-runs`
- `GET /api/sessions/:id/report`
- `POST /api/sessions/:id/report`
- `GET /api/stt/status`
- `POST /api/stt/transcribe`
- `GET /api/health`
- `GET /api/health/db`

### Queue Behavior

- Persona ingestion jobs run through `BullMQ`
- Worker supports simulated scenarios for local development:
  - normal success
  - transient retry then success
  - final failure with fallback
- Queue and worker events are written to `PersonaJobEvent`

## Local Architecture

### App Layer

- `src/app/setup/page.tsx`
- `src/app/interview/[id]/page.tsx`
- `src/app/report/[id]/page.tsx`
- `src/app/admin/page.tsx`

### Core Libraries

- `src/lib/db.ts`: Prisma client
- `src/lib/redis.ts`: Redis connection
- `src/lib/health.ts`: DB and Redis health aggregation
- `src/lib/admin/ops.ts`: admin dashboard data aggregation
- `src/lib/assistant/stages.ts`: coding interview stage inference and progression helpers
- `src/lib/assistant/signal_extractor.ts`: structured candidate-state extraction with provider-backed observation and heuristic fallback
- `src/lib/assistant/decision_engine.ts`: candidate-state-driven interviewer decision selection
- `src/lib/assistant/interviewer_intent.ts`: interviewer intent inference for validate/probe/guide/unblock/advance/close turns
- `src/lib/assistant/trajectory_estimator.ts`: candidate trajectory estimation and intervention-value scoring
- `src/lib/assistant/reply_strategy.ts`: action-specific interviewer wording and fallback turn shaping
- `src/lib/assistant/policy.ts`: explicit stage policy, exit criteria, hint escalation, and prompt strategy selection
- `src/lib/assistant/generate-turn.ts`: multi-provider assistant turn generation, provider sequencing, critic-aware rewrite passes, and decision-compliance enforcement
- `src/lib/assistant/critic.ts`: structured interviewer-turn review for specificity, intensity, repetition, code-readiness gating, evidence saturation, and “worth asking now” timing checks
- `src/lib/assistant/session_critic.ts`: session-level interviewer QA summary for redundancy, interruption, pressure balance, timing, flow, and closure
- `src/lib/assistant/pacing.ts`: explicit pacing assessment for implementation urgency, evidence sufficiency, question worth, pressure selection, and closure timing
- `src/lib/assistant/pass_conditions.ts`: topic/stage pass-condition evaluation for implementation, testing, complexity, and wrap-up
- `src/lib/assistant/hinting_ledger.ts`: hint granularity, rescue-mode classification, and hint-cost aggregation
- `src/lib/usage/cost.ts`: rough token/audio cost estimation and session usage summaries
- `src/lib/usage/budget.ts`: session budget guardrail and budget-cap closure messaging
- `src/lib/evaluation/report.ts`: snapshot-aware, rubric-driven report generation with evidence trace, execution-aware scoring, candidate DNA profiling, and moment-of-truth extraction
- `src/lib/session/snapshots.ts`: best-effort persistence plus snapshot-first read helpers for candidate-state, interviewer-decision, intent, and trajectory snapshots
- `src/lib/session/state.ts`: canonical snapshot-state aggregation for report/admin consumers, including intent and trajectory summaries
- `src/lib/session/budget-enforcement.ts`: budget-cap closure handling for assistant turns
- `src/lib/persona/queue.ts`: BullMQ queue helpers
- `src/lib/persona/ingest-public-profile.ts`: public-profile fetching, heuristic extraction, and persona synthesis with graceful fallback
- `src/lib/persona/job-events.ts`: persona event persistence
- `src/lib/voice/browser-voice-adapter.ts`: browser speech recognition and synthesis adapter
- `src/lib/voice/turn-taking.ts`: interruption-aware silence and commit timing policy

### Worker

- `src/workers/persona-worker.ts`

### Database

- Prisma schema: `prisma/schema.prisma`
- Migrations:
  - `prisma/migrations/20260328000000_init`
  - `prisma/migrations/20260328010000_persona_job_events`
  - `prisma/migrations/20260328020000_session_state_snapshots`

## Local Development

### 1. Start Infra

```powershell
Set-Location 'E:\AI interviewer'
docker compose up -d
```

### 2. Start App

```powershell
Set-Location 'E:\AI interviewer'
npm run dev
```

### 3. Start Persona Worker

In a second terminal:

```powershell
Set-Location 'E:\AI interviewer'
npm run worker:persona
```

### 4. Open the App

- Setup: [http://localhost:3000/setup](http://localhost:3000/setup)
- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Environment Variables

See `.env.example`

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_interviewer?schema=public"
REDIS_URL="redis://localhost:6379"
LLM_PROVIDER=""
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-4.1-mini"
OPENAI_STT_MODEL="gpt-4o-mini-transcribe"
STT_PROVIDER=""
ASSEMBLYAI_API_KEY=""
ASSEMBLYAI_STT_MODELS="universal-3-pro,universal-2"
```

When STT credentials are configured:

- `OPENAI_API_KEY` + `STT_PROVIDER=openai` (or no `STT_PROVIDER`) enables OpenAI STT
- `ASSEMBLYAI_API_KEY` + `STT_PROVIDER=assemblyai` enables AssemblyAI STT
- if both are present and `STT_PROVIDER` is unset, the app currently prefers AssemblyAI for dedicated STT
- interviewer text generation can still use Gemini or OpenAI independently of the STT provider choice

## Test Commands

### Unit and Route Tests

```powershell
npm run test
```

### End-to-End Tests

```powershell
npm run test:e2e
```

### Production Build

```powershell
npm run build
```

### System Design Batch Evaluation

```powershell
# print calibration + regression summary JSON
npm run eval:system-design

# optional: write snapshot JSON to a file
npm run eval:system-design -- --out artifacts/system-design-eval.json

# weekly snapshot + drift trend (writes to docs/metrics/system-design-weekly/)
npm run eval:system-design:weekly
```

## Current Test Coverage

### Vitest

- Persona URL normalization
- Persona source type detection
- Health route behavior
- Interviewer profile preview route behavior
- Sessions route behavior
- Assistant-turn fallback generation and stage-aware behavior
- Interviewer intent inference and trajectory estimation
- Reply strategy shaping and issue-aware fallback phrasing
- Signal extraction and candidate-state reasoning
- Decision-engine behavior for stuck/debugging/tradeoff/testing cases
- Session-level critic summaries plus snapshot-first state aggregation
- Stage inference, policy decisions, and prompt strategy behavior
- Streaming assistant-turn route behavior
- Voice turn-taking policy behavior
- Session code-run route behavior
- Session report route behavior
- Evidence-based report generation
- Admin unified feed aggregation

### Playwright

- Setup -> persona queue -> admin visibility
- Setup -> tailored session creation -> interview room persona rendering

## Known Limitations

- Public persona ingestion now attempts real public-page fetching and heuristic extraction, but still falls back when sources are blocked, sparse, or hostile to scraping
- Realtime AI conversation is still browser speech recognition plus `SSE` streaming rather than a full duplex low-latency voice stack
- Browser speech recognition depends on Web Speech API availability and varies by browser
- Dedicated STT and provider-first voice mode now support a switchable provider layer, with OpenAI and AssemblyAI options
- Gemini and OpenAI interviewer turns can still hit provider rate limits; when that happens the system falls back to local interviewer heuristics
- LLM-backed signal extraction uses the same provider availability rules, so observer quality may also degrade to heuristics under provider failure or rate limits
- Live provider drafts are periodic previews rather than true token-level streaming ASR
- Code execution still defaults to a local process unless Docker sandboxing is enabled, but now supports Python, JavaScript, and C++
- Authentication is still stubbed around a demo user
- Prisma generation on Windows can fail if `dev` or `worker` processes are locking the Prisma engine file.
- After applying the 20260328020000_session_state_snapshots migration to the local Docker Postgres, session snapshot persistence now requires the app process to be restarted once if it had previously auto-disabled snapshot writes due to missing tables.

## Execution View

This README is intentionally condensed for fast context loading.

### Snapshot (April 12, 2026)

- System design interviewer `Phase 0/1/2/3/4/5/6/7/8/9`: baseline completed.
- Question-bank launch now supports pre-room level selection for system-design interviews (`NEW_GRAD`, `SDE1`, `SDE2`, `SENIOR`, `STAFF`).
- Report page now includes:
  - System Design Assessment (radar + evidence pins)
  - Whiteboard weak-signal observability (analysis only, excluded from decision path)
- Report scoring guard fixed: no-evidence sessions cannot receive inflated system-design scores.

### Local Test Reliability (EPERM Workaround)

- Tests now run through a safe wrapper script: `scripts/run-vitest-safe.mjs`.
- Behavior:
  - runs Vitest with `vitest.config.mjs`
  - if Windows `spawn EPERM` is detected, attempts `esbuild` unblock/repair automatically
  - retries once and surfaces clear remediation guidance if still blocked
- Prefer these commands:
  - `npm run test`
  - `npm run test:watch`

### Detailed Docs

- Full roadmap archive (moved from README):
  - [Roadmap Archive](docs/roadmaps/roadmap-archive-2026-04-12.md)
- Current system-design execution status and phase notes:
  - [System Design Execution Plan](docs/roadmaps/roadmap-archive-2026-04-12.md#system-design-interviewer-execution-roadmap-v2-final-executable)

### Final Polish Roadmap (v2.1)

Goal:
- move from "behavior looks right" to "decision quality is measurable and auditable"

Priority track (`P0 + P2`, parallel, highest):
- Calibration x Regression hardening
  - build transcript-based calibration evaluation packs (real-session stratified samples by level)
  - add `NoiseTag`:
    - `STT_CORRUPTION`
    - `PARTIAL_TRANSCRIPT`
    - `INTERRUPTED_TURN`
  - invariants:
    - noise-tagged turns do not contribute to handwave penalty
    - noise-tagged turns do not trigger pivot accounting
    - noise-tagged turns do not contaminate reward attribution
  - strengthen pivot metrics:
    - `trigger_action`
    - `delta_time` (turns/seconds)
    - `dimension_jump`
    - `impact_score` (0-1)
  - expose `Nudge Conversion Rate`:
    - `conversion_rate = pivot_count / guide_count`
  - regression targets:
    - `late_bloomer` can recover
    - `bullshitter` gets suppressed
    - `rigid` behavior is capped correctly
  - operating cadence:
    - run weekly policy-regression snapshots and track drift trends

Priority track (`P1`):
- Handwave v2 + Gap Routing
  - `Depth Score` dimensions:
    - `numeric_density` (QPS/GB/ms)
    - `constraint_binding` (ties to requirement)
    - `causal_chain` (`because -> therefore`)
    - `specificity` (concrete components/terms)
  - semantic decay:
    - increase handwave score when language is vague (`maybe/probably/usually`) without numbers
  - gap-aware action routing:
    - capacity gap -> `ask_back_of_envelope`
    - reliability gap -> `challenge_spof`
    - component gap -> `probe_tradeoff`
    - bottleneck gap -> `challenge_bottleneck`
  - depth expectation counter:
    - if `low_detail_streak >= 2`, force deeper probing action

Decision stability (`P3`, maintain):
- keep inertia + hysteresis + safety override
- constraints:
  - inertia only applies inside same problem chain
  - hysteresis uses explicit delta threshold
  - hard invariant or budget override always wins

System-design causal loop (`P4`, maintain):
- hard gate:
  - block deep-dive when capacity prerequisite is missing
- soft consistency penalty:
  - penalize reliability/quality when architecture contradicts stated capacity

Transcript-native drill-down (`P1.5`):
- add pointer model:
  - `TextPointer { turnId, start, length }`
- use in report/admin/calibration:
  - report-side drill-down links each system-design evidence pin to exact transcript turn spans
  - click evidence -> highlight exact source span

Three open closure gaps to resolve next:
1. unify `GapState` as a first-class layer before decision routing
2. enforce cross-stage reward consistency (not only per-stage scoring)
3. bind pivot strength into level mapping (with cap guardrails)

Next single commit to start:
- `Handwave v2 + Gap Routing + Depth Score` (system-design path first)
  - `src/lib/assistant/signal_extractor.ts`
  - `src/lib/assistant/system_design_decision.ts`
  - `src/lib/assistant/reward.ts`

