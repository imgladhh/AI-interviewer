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
- Streaming assistant turns now preserve spoken/live wording as the authoritative final transcript when a post-stream critic rewrite would materially change the interviewer intent, which keeps TTS/live draft output aligned with the persisted transcript.
- decision_engine now avoids immediately repeating `testing`, `edge_case`, `complexity`, and `tradeoff` targets once the candidate has already supplied the relevant evidence, and instead moves the interview forward.
- interviewer closure logic now explicitly models `move_to_wrap_up`, `close_topic`, and `end_interview`, so once evidence is saturated the system stops saying `Keep going` and closes the topic cleanly.
- critic verdicts now track `evidenceAlreadySaturated` and `recommendedClosure`, so repeated wrap-up, summary, testing, and complexity loops can be converted into explicit closure turns instead of more probing.
- Added `interviewer_intent.ts` so each turn can explicitly model why the interviewer is acting now (`validate`, `probe`, `guide`, `unblock`, `advance`, `close`) instead of only what action it takes.
- Added `trajectory_estimator.ts` so interviewer control can reason about whether the candidate is self-recovering, plateauing, stuck, or steadily progressing before deciding to intervene.
- decision_engine v3 now consumes `intent + trajectory + pass conditions + pacing`, pushing the interviewer from purely state-driven behavior toward intent-driven, trajectory-aware behavior.
- Added pass-condition/topic gates for implementation, complexity, testing, and wrap-up so stage exits are backed by explicit completion criteria instead of only heuristics.
- Intent and trajectory snapshots are now persisted and loaded through the snapshot-first pipeline, so `/admin` and `/report` can explain not just what happened, but why the interviewer chose that path.
- Added `session_critic.ts` as a session-level meta-review layer, scoring redundancy, interruption quality, pressure balance, flow preservation, timing quality, and closure quality across the whole interview.
- `/admin` and `/report` now surface latest interviewer intent, latest trajectory estimate, and a session-level critic summary in addition to turn-level decision and critic metadata.
- Candidate-state and interviewer-decision snapshots now have dedicated persistence tables plus snapshot-first read helpers, so `/admin` and `/report` can load canonical state without replaying the full event stream at runtime.
- Added tests for signal extraction, decision logic, evidence-based reporting, reply strategy shaping, provider compliance handling, and provider fallback ordering.
- signal extraction now records finer correctness failure patterns such as missing proof sketches, imprecise expected outputs for test cases, shallow tradeoff analysis, and tradeoffs that are not justified against the actual constraints.
- /admin and /report now group observed candidate issues by Correctness, Testing, Complexity, and Debugging so interviewer quality is easier to inspect at a glance.
- /admin and /report replay now surface unresolved issues, missing evidence, answered targets, collected evidence, and the current evidence focus so interviewer pacing is easier to debug visually.
- `/admin` and `/report` now also surface the latest interviewer `pressure`, critic `Worth Asking`, and critic `Worth Reason` as top-level summary cards instead of hiding them only in replay payloads.
- `/report/[id]` stage replay is now grouped by stage from canonical snapshots plus event evidence, which makes product-facing replay much closer to a real interview debrief.
- Added `hinting_ledger.ts` so the interviewer can classify hint granularity, rescue mode, and hint cost instead of only recording that a hint happened.
- decision_engine hint actions now carry `rescueMode`, `hintGranularity`, and `hintCost`, so rescue behavior is explicit rather than buried in generic hint metadata.
- report generation now aggregates hint cost, strongest hint level, rescue-mode mix, efficiency score, and coachability so feedback reflects not just whether help happened, but how much help the candidate needed and how efficiently the candidate converted signals into evidence.
- report generation now produces deeper evidence traces, execution-aware evaluation signals, candidate DNA, moments of truth, and rubric summaries so the final report reads more like a real interview debrief than a generic AI recap.
- `/admin` latest-session summary now derives current stage and stage journey from canonical snapshots instead of replaying events to rebuild live state.
- Added a hard session budget guardrail at `$2.00` estimated usage: assistant-turn routes now emit `SESSION_BUDGET_EXCEEDED`, end the interview, and return a clean budget-closure reply instead of continuing indefinitely.
- Code execution now supports a stronger sandbox path with optional Docker isolation (`CODE_SANDBOX_DRIVER=docker`) plus stricter local timeout cleanup to kill runaway process trees.

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
- Evaluation/report is still lightweight compared with a full rubric system, but it now includes evidence-backed state, replay, timing metadata, and hint-cost accounting
- Snapshot-first state is in place for `/admin` and `/report`, but the replay view still mixes canonical snapshots with event evidence rather than a full transcript-native playback model
- Prisma generation on Windows can fail if `dev` or `worker` processes are locking the Prisma engine file.
- After applying the 20260328020000_session_state_snapshots migration to the local Docker Postgres, session snapshot persistence now requires the app process to be restarted once if it had previously auto-disabled snapshot writes due to missing tables.

## Current Roadmap

The current roadmap intentionally avoids changing the core interviewer architecture. The main pipeline is already stable:

`Perception -> Memory -> Intent -> Trajectory -> Decision -> Pacing -> Reply -> Critic -> Snapshot -> Report/Admin`

The next phase is to make that pipeline behave more differently under policy/persona, sound more natural in voice, and produce harder, more trustworthy evaluation output.

### Priority 1: Policy-Driven Behavior Adaptation

Goal:
- make `PolicyConfig` affect real interviewer behavior rather than only metadata and replay output

Concrete work:
- wire policy archetypes into:
  - `src/lib/assistant/decision_engine.ts`
  - `src/lib/assistant/pacing.ts`
  - `src/lib/assistant/hint_strategy.ts`
- wrap policy behavior with an explicit invariant guard so policy cannot override:
  - budget / clock closure constraints
  - collapse / unblock safety behavior
  - anti-repetition
  - no-hint-after-completion rules
- make archetypes such as `bar_raiser` and `collaborative` produce visibly different:
  - pressure curves
  - move-to-implementation bias
  - close-topic aggression
  - hint timing and maximum hint level
- make `/admin` and `/report` distinguish:
  - behavior chosen because of policy
  - behavior overridden by invariant guard
- add a decision pathway view so each turn can be explained as:
  - `Policy -> Action`
  - or `Policy -> Invariant Override -> Action`
- keep policy deterministic and observable through snapshots, `/admin`, and `/report`

Success criteria:
- the same transcript produces different but explainable interviewer behavior under different archetypes
- invariants still override policy when necessary
- manually changing `PolicyConfig` produces a deterministic and inspectable behavior shift

Phase 1 status:
- policy now affects real interviewer behavior in:
  - `src/lib/assistant/decision_engine.ts`
  - `src/lib/assistant/pacing.ts`
  - `src/lib/assistant/hint_strategy.ts`
- invariant enforcement now runs before the final decision snapshot is emitted
- decision snapshots now record a visible decision pathway such as:
  - `Policy(collaborative) -> Action(encourage_and_continue)`
  - `Policy(bar_raiser) -> Invariant(flow_preservation) -> Action(hold_and_listen)`
- `/admin` now surfaces that pathway in both the latest decision card and the session timeline, so policy effect vs invariant override is inspectable without digging through raw payloads

### Priority 2: Voice Naturalness

Goal:
- close the gap between typed interviews and voice interviews

Concrete work:
- improve interruption handling and turn-taking in:
  - `src/components/interview/interview-room-client.tsx`
  - `src/lib/voice/turn-taking.ts`
  - `src/lib/voice/browser-voice-adapter.ts`
- add authoritative stream locking so once a spoken turn starts, the core intent/question cannot drift underneath the transcript
- keep spoken/live assistant text aligned with final transcript text
- refine silence thresholds and filler-word handling
- make silence handling dynamic based on whether the candidate is actively coding or paused
- add soft interruption protection for think-aloud phrases such as:
  - `wait`
  - `let me think`
  - `hold on`
  - `let me see`
- make silence handling sensitive not just to stage, but also to low-certainty / negative-intent voice fragments during coding
- reduce awkward double-speak, premature cutoffs, and stale provider preview behavior

Phase 1 status:
- implemented active-coding-aware voice delays so speech turns are given more room during `IMPLEMENTATION` and `DEBUGGING`
- implemented flow-aware voice timing so `discussion`, `coding`, `debugging`, and `wrap_up` now tolerate pauses differently
- added conservative filler/noise cleanup in `src/lib/voice/transcript-normalization.ts`
- added low-signal utterance filtering so filler-only fragments like `um yeah so` do not get committed as candidate turns
- added client-side authoritative assistant reply handling in `src/lib/voice/assistant-stream.ts` so the remaining TTS tail follows the final authoritative transcript instead of a stale streamed draft
- added think-aloud / negative-intent protection for phrases like `wait`, `let me think`, and `hold on`, so coding/debugging turns get a longer silence threshold before auto-submit
- kept the first slice intentionally narrow and deterministic; deeper voice work should extend these rules instead of replacing them

Success criteria:
- voice sessions feel closer to a real interviewer conversation
- spoken AI, on-screen draft, and persisted transcript stay consistent
- transcript text is denoised enough that `signal_extractor` is not polluted by filler-heavy turns

### Priority 3: Rubric / Evaluation Hardening

Goal:
- move the report from strong qualitative debrief to a more formal rubric-driven evaluation system

Concrete work:
- strengthen rubric scoring in:
  - `src/lib/evaluation/report.ts`
- make `Correctness`, `Complexity`, `Communication`, `Debugging`, and `Independence` scores more explicit and better grounded
- pin each rubric score to concrete evidence:
  - snapshot ids
  - code run ids
  - turn-level evidence points
- improve level-bar interpretation for:
  - junior / mid / senior style performance
- continue strengthening:
  - evidence trace
  - candidate DNA
  - moments of truth
  - coachability
  - efficiency score
- add stronger coachability measurement from hint conversion:
  - how quickly a nudge turns back into steady progress

Phase 1 status:
- added rubric evidence pinning for the most important visible dimensions:
  - `Correctness`
  - `Complexity`
  - `Communication`
- `report.ts` now emits `evidenceRefs` alongside rubric scores so a score can point back to:
  - candidate state snapshots
  - decision snapshots
  - execution runs
- `/report/[id]` now surfaces those evidence refs directly in the rubric scorecard instead of hiding the grounding in raw debug data
- `/report/[id]` now also surfaces decision pathway / policy / invariant metadata in the latest interviewer decision card, so the report can explain both the candidate and the interviewer behavior
- report generation now emits an estimated evaluated level plus recommendation rationale, so the top-level verdict reads more like a judgment than a raw score dump
- report generation now also emits a stronger recommendation band plus explicit recommendation basis:
  - independence signal
  - coachability signal
  - execution closure notes
- /report/[id] now surfaces that recommendation basis so the top-level verdict reads more like a hiring judgment than a score dump
- the next report pass should upgrade those refs into stronger evidence traces with:
  - `snapshot_id`
  - `event_id`
  - `execution_run_id`
  - a short note explaining why that evidence matters
- kept the first slice intentionally narrow; the next rubric pass should harden:
  - level mapping
  - stronger hire/borderline/no-hire interpretation
  - coachability and independence calibration

Success criteria:
- reports are easier to trust and easier to compare across sessions
- dimension scores have clearer, evidence-backed rationale
- rubric output reads more like a judgment than a descriptive summary

### Priority 4: Policy Tuning / Offline Evaluation

Goal:
- tune interviewer policy using stable golden scenarios instead of ad hoc rule edits

Concrete work:
- add more golden transcript scenarios around:
  - timing correctness
  - closure quality
  - anti-repetition
  - implementation handoff
  - hint escalation
- expand policy-oriented tests and eval scenarios for:
  - no interruption when candidate is in strong coding flow
  - clean closure when evidence is saturated
  - no repeated probing of answered targets
  - expected archetype differences
- add a policy-diff / strategy-lab workflow:
  - run the same golden transcript through multiple archetypes
  - compare intent timeline, pressure, timing, and closure behavior
- build a policy regression fixture set with at least:
  - a strong / nearly perfect candidate
  - a clearly stuck candidate
  - the same transcript under `bar_raiser` and `collaborative`

Phase 1 status:
- added a minimal strategy-lab module in `src/lib/assistant/policy-regression.ts`
- added golden regression fixtures for:
  - a strong pre-code candidate
  - a stuck debugging candidate
  - a saturated wrap-up candidate
  - a strong coding-flow preservation case
  - an answered-target anti-repetition case
- added archetype comparison coverage in `src/lib/assistant/policy-regression.test.ts`
- added `npm run eval:policies` as a CLI entry point for offline policy scenario inspection
- /admin now includes a lightweight Policy Regression Lab card so archetype differences are visible without opening raw test output
- the strategy lab now surfaces scenario-level diff summaries, so it is obvious when archetypes diverge on action, target, pressure, timing, or stage
- use session critic outputs to identify:
  - over-interruption
  - over-pressure
  - weak closure
  - redundant questioning

Success criteria:
- policy changes become safer and easier to validate
- interviewer tuning is guided by reproducible scenario outcomes
- archetype differences are observable without relying on subjective transcript reading

### Priority 5: UI Polish

Goal:
- make the existing system feel more professional without changing its core architecture

Concrete work:
- improve `/report/[id]` and `/admin` readability
- move toward an executive-summary-first layout:
  - recommendation / level / moments of truth first
  - stage replay and raw transcript second
- keep stage-grouped replay, intent/trajectory visibility, and decision explainability easy to scan
- surface the most important interviewer reasoning without overwhelming the user
- polish room-level feedback so the candidate better understands:
  - current stage
  - AI source
  - budget state
  - voice state

Success criteria:
- the UI feels like a deliberate interview product rather than a debug console
- deeper system reasoning remains visible for development and audit

Phase 1 status:
- `/report/[id]` now starts moving toward an executive-summary-first layout instead of dropping directly into dense detail
- the top of the report now foregrounds:
  - recommendation
  - evaluated level
  - recommendation basis
  - moments of truth
- the report still preserves deeper candidate/interviewer state below, so product-facing readability improves without losing audit depth
- stage replay now reads more like an interview storyline:
  - each phase opens with a short plot summary
  - evidence, checkpoints, interviewer decisions, and representative turns are nested under collapsible detail blocks
- deeper report diagnostics are now pushed under a `Deep Diagnostics` fold so first-time readers see the product-facing summary before the audit-heavy state snapshots and replay timelines
  - `/admin` now also starts with a compact executive summary for the current session posture:
    - current stage
    - latest decision
    - policy archetype
    - invariant override
    - latest intent / trajectory
    - critic timing / closure quality
  - heavy admin detail is increasingly folded behind explicit sections such as:
    - `Session State Timeline`
    - `Raw Job Status JSON`
    - `Unified Operations Feed`
  - `Raw Job Status JSON`
  - `Unified Operations Feed`

## Milestone Guidance

The original Priority 1-5 roadmap is now largely in place as a completed first major iteration:
- policy-driven behavior is live
- voice naturalness phase 1 is live
- rubric / evaluation hardening phase 1 is live
- policy tuning / offline evaluation phase 1 is live
- UI polish phase 1 is live

The next roadmap should build on that base instead of reopening the same priorities.

### Next Roadmap: Interviewer OS

#### Stage 1: Truth Engine

Priority: `P0`

Core goal:
- eliminate state drift so the system only reasons over committed truth

Concrete work:
- add a `Commit Arbiter` in the assistant-turn path
- introduce explicit `PENDING` vs `COMMITTED` transcript state
- ensure decision, critic, and ledger consume only committed content
- add transcript versioning for post-commit STT corrections
- support `correction_of_id`-style evidence-chain updates when previously committed text is revised
- tighten the denoise pipeline so filler is removed conservatively while still preserving short but meaningful confirmations such as `OK` and `Yes`

Phase 1 status:
- `commit-arbiter.ts` is live
- transcript reads now expose `commitState`, `transcriptVersion`, and `correctionOfId`
- `assistant-turn` and `assistant-turn/stream` now consume committed transcripts only
- transcript creation/refinement routes now emit commit metadata needed for replay and future correction chaining
- regression coverage exists for committed-only routing and transcript read decoration

Success criteria:
- no decision is made from half-final or UI-only transcript text
- streamed text, spoken text, committed text, and replay state stay aligned
- STT corrections can update evidence without corrupting the session history

Immediate next implementation:
- refactor assistant-turn routing so no committed decision is produced without passing the commit arbiter

#### Stage 2: Strategist & DNA

Priority: `P1`

Core goal:
- make interviewer policy auditable, comparable, and adaptive to candidate profile

Concrete work:
- add `shadow policy mode` so the system can compare actual vs alternative archetype decisions in the background
- formalize `Candidate DNA` into a structured vector:
  - reasoning
  - implementation
  - coachability
  - independence
- use that vector to influence policy and pressure in a deterministic way
- strengthen decision explainability:
  - chosen intent
  - competing intents
  - invariant override cause
- add counterfactual challenge hooks for logically shaky but overconfident answers

Success criteria:
- policy differences are measurable, not just anecdotal
- candidate DNA becomes a live control input, not just a report output
- `/admin` can explain why one policy path was chosen over another

#### Stage 3: Juror & Rubric

Priority: `P2`

Core goal:
- upgrade the report from AI summary into evidence-backed judgment

Concrete work:
- strengthen `evidence pinning` from lightweight refs into harder evidence traces
- attach rubric dimensions to concrete objects such as:
  - `snapshot_id`
  - `event_id`
  - `execution_run_id`
- harden level mapping for recommendation and leveling logic
- expand calibration around:
  - strong hire
  - borderline
  - no hire
- keep recommendation basis explicit and reviewable

Success criteria:
- every visible score can be traced back to concrete evidence
- level and recommendation outputs feel like judgments, not vague summaries
- rubric changes can be audited and tuned over time

#### Stage 4: Polished Persona

Priority: `P3`

Core goal:
- improve naturalness and pacing without sacrificing truth or control

Concrete work:
- add more semantic voice control for silence thresholds
- refine think-aloud / hesitation handling
- add a light “thinking latency” illusion only where it helps realism
- treat editor activity as a weak auxiliary signal for struggling / flow detection
- continue polishing room-level state feedback without turning the UI back into a debug wall

Success criteria:
- voice interactions feel more natural without breaking transcript truthfulness
- pacing feels deliberate instead of reactive
- realism improvements never override correctness or observability

### Atomic Invariants

These remain permanent system rules regardless of roadmap stage:
- `Budget First`: if estimated session cost crosses the hard threshold, gracefully close
- `Anti-Repetition`: do not re-probe targets that are already sufficiently evidenced
- `Safety Sandbox`: keep Docker + timeout isolation as the runtime baseline
- `Flow Preservation`: do not interrupt high-velocity coding flow unless a higher-priority invariant forces it

### Execution Discipline

- no new strategy should bypass the commit / truth model
- policy changes should be checked against golden scenarios before they are trusted
- `/admin` must continue to distinguish:
  - policy effect
  - invariant override
  - committed vs pending truth boundaries
- build and full test runs should stay green as a release gate

### Follow-up TODOs

- `Wrap-up closure cleanliness`
  - when the candidate has already declared implementation complete and has already delivered a final summary, the interviewer should close cleanly instead of reopening with lines such as:
    - `feel free to proceed with your implementation`
    - `keep moving`
  - strengthen `candidateDeclaredDone` / `implementationAlreadyDone` tracking in memory and decision logic
  - add a regression scenario so:
    - implementation done + summary done -> `close_topic` or `end_interview`
    - no reopen of implementation after wrap-up
















