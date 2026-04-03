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
- Default interviewer skills layer for tone, pacing, follow-up discipline, and coaching-without-spoiling
- Browser voice loop with interruption handling, continuous listening, and turn-taking policies
- Dedicated STT handoff for spoken candidate turns, with provider selection and browser transcript fallback
- Dedicated STT-backed voice mode with provider-led turn detection, provider preview drafts, usage logging, low-cost mode controls, and switchable STT providers
- `Vitest` unit/route tests and `Playwright` end-to-end tests
- Full `Vitest` coverage is now green locally again (`176 passed / 33 files`), so test validation is part of the normal development loop rather than a blocked follow-up task.

## Recent Progress

- Added stronger coding interview policy orchestration:
  - current stage is derived from transcripts, session events, and the latest code run
  - assistant turns receive explicit stage context plus policy context
  - each stage has an explicit exit checklist
  - hints now escalate by recent hint count, stage stall, and repeated failed runs
  - prompt strategy can shift from `OPEN_ENDED` to `GUIDED` to `CONSTRAINED`
  - `STAGE_ADVANCED` is only recorded when the stage actually changes
- Improved the interview room so it feels more like a real conversation:
  - streaming AI replies over `SSE`
  - continuous listening mode
  - candidate speech interrupts AI playback and generation
  - adaptive silence thresholds for auto-submit
  - short interruption phrases like `wait` and `hold on` are ignored instead of being treated as full candidate turns
  - spoken candidate turns can be refined through a dedicated STT provider before being sent to the interviewer
  - when a dedicated STT provider is configured, the room can prefer provider-led speech handling over browser transcript timing
  - provider preview drafts can appear during speech, with final provider transcription used for the committed candidate turn
- Added session-level cost controls and observability:
  - `low-cost mode` can be enabled from setup
  - LLM context is trimmed more aggressively in low-cost mode
  - provider preview and STT calls are throttled more aggressively in low-cost mode
  - per-session `LLM_USAGE_RECORDED` and `STT_USAGE_RECORDED` events now produce rough cost estimates
  - interview room surfaces current LLM/STT call counts and estimated total cost
- Replaced the static code panel with a real Monaco editor
- Added session code execution flow:
  - `CodeSnapshot` records are created on run
  - `ExecutionRun` records are persisted
  - session timeline includes code-run-related events
- Added multi-provider LLM support for interviewer turns:
  - `Gemini`
  - `OpenAI`
  - local `fallback`
- Improved provider fallback visibility and resilience:
  - Gemini and OpenAI failures now surface more clearly in development logs
  - fallback turns can carry provider-failure context back to the room
  - the interview room now shows the latest AI source (`gemini`, `openai`, or `fallback`)
  - Gemini turns now record `LLM_USAGE_RECORDED` events too, even when cost is tracked as unknown
- Improved dedicated STT provider handling:
  - OpenAI and AssemblyAI now share a common STT provider abstraction
  - dedicated STT failures are classified into classes like `quota`, `auth`, `model`, `network`, and `timeout`
  - quota-like failures now auto-disable dedicated STT for the current room and fall back to browser transcription
  - voice diagnostics now include richer browser preflight and live microphone-level visibility
- Improved interviewer quality with a shared interviewer-skills layer:
  - warmer but still professional tone
  - clearer pacing
  - better follow-up discipline
  - less repetitive phrasing
- Improved `/admin` unified operations feed:
  - richer descriptions for session lifecycle events
  - readable stage transition descriptions
  - persona and session activity rendered in one timeline
- Expanded tests around:
  - full-route and assistant-turn regressions now run cleanly in local Vitest again
  - assistant stage inference
  - assistant-turn generation and stage transitions
  - streaming routes
  - voice turn-taking policies
  - admin feed event descriptions
- Added evaluation/report v0:
  - `POST /api/sessions/:id/report` generates a structured feedback summary
  - reports persist to `Evaluation`, `EvaluationDimensionScore`, and `FeedbackReport`
  - report generation now emits explicit lifecycle events
  - `/report/[id]` provides a standalone report page
  - the report page includes a lightweight replay of stage transitions, hints, code runs, and key turns

## Latest Interviewer Quality Upgrades

- Added signal_extractor as a perception layer with provider-backed structured observation first and heuristic fallback second.
- Added decision_engine as a candidate-state-driven interviewer control layer, so turns are chosen from candidate signals plus stage and code-run evidence.
- Gemini/OpenAI replies are now explicitly steered by the decision engine, shaped by a dedicated reply strategy layer, and post-processed to fall back to the required decision question when a model reply is too generic.
- provider prompts now receive structured candidate issues, issue groups, issue-specific instructions, and expected-answer contracts so Gemini/OpenAI can act more like execution layers than free-form chat models.
- Text-provider fallback is now an explicit sequence: preferred provider -> secondary provider -> local fallback.
- Added `reply_strategy.ts` so decision actions such as `probe_tradeoff`, `probe_correctness`, and `hold_and_listen` map to more interviewer-like wording across provider-backed and local fallback turns.
- decision_engine v2 now distinguishes between:
  - probing tradeoffs when the algorithm choice is weak
  - probing correctness when implementation looks close but reasoning is still thin
  - holding the floor and lightly steering when the candidate is progressing in a structured way
- /admin now exposes latest session stage, latest candidate state, latest interviewer decision, and a dedicated session-state timeline.
- /report/[id] now shares the same evidence backbone as /admin, including signal snapshots, interviewer decisions, hints, stage transitions, and code-run outcomes.
- decision_engine now consumes fine-grained structured evidence directly, so issue classes like invariant gaps, narrow boundary coverage, and shallow tradeoff analysis can trigger more surgical follow-up questions.
- memory_ledger now tracks `answeredTargets` and `collectedEvidence`, so the interviewer can tell the difference between "I already asked this" and "the candidate already answered this."
- Added `critic.ts` as a lightweight turn-review layer after generation, with structured verdicts for `accept`, `rewrite`, `move_on`, and `move_to_implementation`.
- Added `pacing.ts` as an explicit flow-control layer that scores whether a question is still worth asking now, whether implementation should start, and whether testing/complexity evidence is already sufficient.
- decision_engine decisions now carry a `pressure` level (`soft`, `neutral`, `challenging`, `surgical`) so interviewer turns can vary not just by target but by how hard they should press.
- Critic verdicts now also include `questionWorthAsking` and `worthReason`, so the system can distinguish between “bad wording” and “wrong timing”.
- Critic verdicts are now written into session events and surfaced in `/admin` and `/report` replay so reviewer pressure, specificity, and repetition handling are inspectable.
- Gemini/OpenAI now have a low-cost rewrite pass for weak turns before falling back to rule-based rewrites, which reduces generic follow-ups and repeated answered targets.
- decision_engine now avoids immediately repeating `testing`, `edge_case`, `complexity`, and `tradeoff` targets once the candidate has already supplied the relevant evidence, and instead moves the interview forward.
- interviewer closure logic now explicitly models `move_to_wrap_up`, `close_topic`, and `end_interview`, so once evidence is saturated the system stops saying `Keep going` and closes the topic cleanly.
- critic verdicts now track `evidenceAlreadySaturated` and `recommendedClosure`, so repeated wrap-up, summary, testing, and complexity loops can be converted into explicit closure turns instead of more probing.
- Candidate-state and interviewer-decision snapshots now have dedicated persistence tables plus snapshot-first read helpers, so `/admin` and `/report` can load canonical state without replaying the full event stream at runtime.
- Added tests for signal extraction, decision logic, evidence-based reporting, reply strategy shaping, provider compliance handling, and provider fallback ordering.
- signal extraction now records finer correctness failure patterns such as missing proof sketches, imprecise expected outputs for test cases, shallow tradeoff analysis, and tradeoffs that are not justified against the actual constraints.
- /admin and /report now group observed candidate issues by Correctness, Testing, Complexity, and Debugging so interviewer quality is easier to inspect at a glance.
- /admin and /report replay now surface unresolved issues, missing evidence, answered targets, collected evidence, and the current evidence focus so interviewer pacing is easier to debug visually.
- `/admin` and `/report` now also surface the latest interviewer `pressure`, critic `Worth Asking`, and critic `Worth Reason` as top-level summary cards instead of hiding them only in replay payloads.`r`n- `/report/[id]` stage replay is now grouped by stage from canonical snapshots plus event evidence, which makes product-facing replay much closer to a real interview debrief.
- Added `hinting_ledger.ts` so the interviewer can classify hint granularity, rescue mode, and hint cost instead of only recording that a hint happened.
- decision_engine hint actions now carry `rescueMode`, `hintGranularity`, and `hintCost`, so rescue behavior is explicit rather than buried in generic hint metadata.
- report generation now aggregates hint cost, strongest hint level, rescue-mode mix, efficiency score, and coachability so feedback reflects not just whether help happened, but how much help the candidate needed and how efficiently the candidate converted signals into evidence.
- report generation now produces deeper evidence traces, execution-aware evaluation signals, candidate DNA, moments of truth, and rubric summaries so the final report reads more like a real interview debrief than a generic AI recap.

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
- `src/lib/assistant/reply_strategy.ts`: action-specific interviewer wording and fallback turn shaping
- `src/lib/assistant/policy.ts`: explicit stage policy, exit criteria, hint escalation, and prompt strategy selection
- `src/lib/assistant/generate-turn.ts`: multi-provider assistant turn generation, provider sequencing, critic-aware rewrite passes, and decision-compliance enforcement
- `src/lib/assistant/critic.ts`: structured interviewer-turn review for specificity, intensity, repetition, code-readiness gating, evidence saturation, and “worth asking now” timing checks
- `src/lib/assistant/pacing.ts`: explicit pacing assessment for implementation urgency, evidence sufficiency, question worth, pressure selection, and closure timing
- `src/lib/assistant/hinting_ledger.ts`: hint granularity, rescue-mode classification, and hint-cost aggregation
- `src/lib/usage/cost.ts`: rough token/audio cost estimation and session usage summaries
- `src/lib/evaluation/report.ts`: snapshot-aware, rubric-driven report generation with evidence trace, execution-aware scoring, candidate DNA profiling, and moment-of-truth extraction
- `src/lib/session/snapshots.ts`: best-effort persistence plus snapshot-first read helpers for candidate-state and interviewer-decision snapshots`r`n- `src/lib/session/state.ts`: canonical snapshot-state aggregation for report/admin consumers
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

## Current Test Coverage

### Vitest

- Persona URL normalization
- Persona source type detection
- Health route behavior
- Interviewer profile preview route behavior
- Sessions route behavior
- Assistant-turn fallback generation and stage-aware behavior
- Reply strategy shaping and issue-aware fallback phrasing
- Signal extraction and candidate-state reasoning
- Decision-engine behavior for stuck/debugging/tradeoff/testing cases
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
- Code execution is local-process based and currently supports Python and JavaScript only
- Authentication is still stubbed around a demo user
- Evaluation/report is still lightweight compared with a full rubric system, but it now includes evidence-backed state, replay, timing metadata, and hint-cost accounting
- Snapshot-first state is in place for `/admin` and `/report`, but the replay view still mixes canonical snapshots with event evidence rather than a full transcript-native playback model
- Prisma generation on Windows can fail if `dev` or `worker` processes are locking the Prisma engine file.
- After applying the 20260328020000_session_state_snapshots migration to the local Docker Postgres, session snapshot persistence now requires the app process to be restarted once if it had previously auto-disabled snapshot writes due to missing tables.

## Next Recommended Work

### Product and Backend

- Group report replay by stage and add richer per-stage evidence
- Push LLM-backed signal extraction deeper and persist candidate-state snapshots outside the event stream
- Keep hardening snapshot-first state loading and reduce the remaining event-derived fallback paths
- Continue strengthening typed interviewer quality through richer decision actions and action-specific reply shaping
- Harden real persona ingestion with better extraction quality, retry behavior, and source-specific heuristics
- Expand code execution from local process execution to a stronger sandbox model
- Evolve report generation from v0 into a more rubric-driven evaluation pipeline
- Push provider-first voice mode from periodic preview to true streaming STT/VAD
- Add hard session budget controls on top of rough usage logging

### Queue and Observability

- Add admin filters by status, source type, and time range
- Add explicit per-session timeline and stage journey view in admin
- Surface per-session replay markers directly in admin
- Add queue metrics and failure counts
- Add retry controls or requeue actions in admin

### Testing

- Add route and integration tests for interviewer profile creation, polling, job events, and admin APIs
- Add worker-level integration tests for:
  - retry-once success
  - permanent failure
  - event persistence completeness
- Add Playwright flows for:
  - generic session launch
  - retry persona flow
  - final fallback flow

## Suggested Near-Term Milestones

### Milestone 1

- Stage-grouped replay in reports
- Persist candidate-state snapshots in dedicated tables, not only events
- More route and worker tests

### Milestone 2

- Real persona ingestion pipeline
- Stronger execution sandbox
- Richer evaluation, replay, and session analytics signals

### Milestone 3

- System design mode
- Personalized study history and analytics

















