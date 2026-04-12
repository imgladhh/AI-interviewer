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

- System design interviewer `Phase 0/1/2/3/4/5/6/7` is completed (including whiteboard UX with aux-only weak signals).
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

Status: `Completed`

Priority 5 implementation summary:
- `/report/[id]` now follows an executive-summary-first layout instead of opening on dense audit detail
- the report header now foregrounds:
  - recommendation
  - evaluated level
  - recommendation basis
  - moments of truth
- stage replay now reads like an interview storyline:
  - each stage begins with a short plot summary
  - evidence, checkpoints, interviewer decisions, and representative turns sit behind collapsible detail blocks
- deeper report diagnostics are now intentionally folded under `Deep Diagnostics`, so first-time readers see product-facing conclusions before audit-heavy state dumps
- `/admin` now starts with a compact executive summary of current session posture, including:
  - current stage
  - latest decision
  - policy archetype
  - invariant override
  - latest intent / trajectory
  - critic timing / closure quality
  - transcript truth posture
- heavier admin detail is now pushed behind explicit sections such as:
  - `Session State Timeline`
  - `Raw Job Status JSON`
  - `Unified Operations Feed`
  - `Policy Regression Lab`
- the interview room now gives clearer, lower-noise state feedback around:
  - current stage
  - AI source
  - budget/cost posture
  - voice state
  - compact system state

Exit criteria met:
- `/report`, `/admin`, and the interview room now feel substantially more like a deliberate product surface than a raw debug console
- critical reasoning and audit state remain available, but are visually secondary to the primary operating summary

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

Status: `Completed`

Stage 1 implementation summary:
- `commit-arbiter.ts` is live and now resolves the latest committed correction chain instead of only filtering pending turns
- transcript reads now expose:
  - `commitState`
  - `transcriptVersion`
  - `correctionOfId`
  - `supersededById`
- `assistant-turn` and `assistant-turn/stream` now consume committed transcripts only
- transcript creation/refinement routes now emit commit metadata needed for replay and correction chaining
- session detail reads now return committed/current transcript truth plus a transcript-truth summary
- interview room initial transcripts now start from committed/current truth instead of raw transcript history
- code-run stage derivation now uses committed transcript truth, so superseded STT versions do not skew stage movement
- report generation and report replay now consume latest committed truth instead of raw transcript history
- `/admin` and `/report` now surface transcript-truth audit metrics:
  - active committed
  - superseded
  - pending
  - versioned
- `/admin` session truth summary now includes full transcript refinement chains rather than only the latest visible event window
- regression coverage now exists for:
  - committed-only assistant turns
  - transcript version decoration
  - superseded transcript exclusion in reports
  - committed-truth session detail reads
  - committed-truth code-run stage derivation

Success criteria:
- no decision is made from half-final or UI-only transcript text
- streamed text, spoken text, committed text, and replay state stay aligned
- STT corrections can update evidence without corrupting the session history

Exit criteria met:
- no decision is made from half-final or UI-only transcript text
- committed truth now survives STT correction chains without poisoning downstream decision/report paths
- truth state is inspectable in `/admin` and `/report` instead of being hidden inside transcript route internals

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

Status: `Completed`

Stage 2 implementation summary:
- added `src/lib/assistant/candidate_dna.ts` for a deterministic DNA vector:
  - reasoning
  - implementation
  - coachability
  - independence
- candidate DNA now deterministically adapts the live policy mode:
  - `guided`
  - `balanced`
  - `challenging`
- assistant turns now emit:
  - `CANDIDATE_DNA_RECORDED`
  - `SHADOW_POLICY_EVALUATED`
- `shadow policy` now compares the active archetype against a deterministic counter-archetype:
  - `bar_raiser <-> collaborative`
- decision explainability is stronger across live turns:
  - chosen intent
  - competing intents
  - policy mode
  - policy adaptation reason
  - invariant override cause
- a counterfactual challenge hook now exists for overconfident but thin reasoning before implementation
- `/admin` now surfaces:
  - latest candidate DNA
  - latest shadow-policy evaluation
  - diff fields between actual and shadow policy
  - competing intents
  - policy adaptation details
- `/report` now surfaces:
  - latest candidate DNA
  - latest shadow policy
  - policy mode / policy adaptation
  - competing intents

Exit criteria met:
- policy differences are measurable instead of anecdotal
- candidate DNA is now a live control input, not just a report output
- `/admin` and `/report` can explain why one policy path was chosen over another

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

Status: `Completed`

Stage 3 implementation summary:
- rubric evidence pinning was upgraded from lightweight refs into harder evidence traces with:
  - `kind`
  - `id`
  - `label`
  - `note`
- report generation now threads concrete object ids into rubric judgments:
  - `candidate_state_snapshot`
  - `decision_snapshot`
  - `execution_run`
  - `session_event`
- `/api/sessions/[id]/report` now passes execution run ids through to the report generator so judgment output can pin to executable evidence
- recommendation calibration is now more explicit:
  - `reasoningSignal`
  - `executionSignal`
  - `independenceSignal`
  - `coachabilitySignal`
- report generation now emits a `calibrationMatrix` so the final call is inspectable instead of hidden inside prose
- `/report/[id]` now surfaces:
  - recommendation evidence trace
  - calibration matrix
  - rubric evidence-ref notes

Exit criteria met:
- every visible score can now be traced to concrete evidence with a note, not just a generic label
- level and recommendation output now read more like judgment than recap
- calibration is explicit enough to audit and tune over time

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

Completed status:
- extended `src/lib/voice/turn-taking.ts` with softer hesitation cues such as:
  - `maybe`
  - `i think`
  - `let me try`
  - `if I`
- voice turn submission now treats those cues as “thinking out loud” during coding/debugging, which raises silence thresholds instead of prematurely committing the turn
- streaming assistant turns now emit a lightweight delivery profile, so challenge/probe turns can take a small deterministic lead-in before TTS starts speaking
- the interview room now uses that lead-in as a measured “thinking beat” without changing committed transcript truth
- Monaco editor activity is now emitted as weak telemetry through `EDITOR_ACTIVITY_RECORDED`
- `trajectory_estimator.ts` now treats editor rewrite churn and long coding pauses as low-weight struggling signals rather than hard truth
- the interview room now surfaces a compact system-state pill, so the room can say whether it is:
  - listening
  - capturing
  - deciding
  - deliberately pausing before reply
  - streaming
- these changes stay within the truth boundary:
  - committed transcript remains authoritative
  - realism changes affect delivery and pacing, not transcript correctness

Exit criteria met:
- voice pacing now feels more deliberate in coding/debugging flow
- think-aloud fragments are less likely to be committed too early
- realism improvements remain auditable and do not override committed truth

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

### Next Phase Roadmap: Convergence Phase

With `Priority 1-5` and `Stage 1-4` now completed, the next iteration is no longer about adding more interviewer behaviors. It is about converging the system into a stable, tunable, and fully explainable optimization engine.

#### Phase 1: Decision Engine Convergence

Priority: `P0`

Core goal:
- converge the current multi-module decision path into a single unified scoring surface

Concrete work:
- implement `UnifiedDecisionScore v1`:
  - `Score(A) = Σ w_i(A) * S_i(A) + HardMask(A) - SoftPenalty(A)`
  - require all normalized component scores to stay inside `[-1, 1]`
  - require every decision to emit score decomposition
- standardize action candidates into a single normalized set:
  - `Probe`
  - `Guide`
  - `Unblock`
  - `Advance`
  - `Close`
  - `Hold`
- bind `DecisionResult.reason[]` directly to score decomposition
- split constraints into:
  - hard masks
  - soft penalties
- add decision stability / tie-breaking when the top two actions are too close

Phase 1 status:
- `UnifiedDecisionScore v1` is now wired into `decision_engine.ts` behind the existing proposal path, so every decision emits:
  - a normalized action family
  - total score
  - score decomposition
  - candidate score surface
  - tie-break metadata when needed
- hard masks and soft penalties are now explicit in score decomposition instead of remaining implicit in branching only
- normalized action families now converge through one candidate set:
  - `Probe`
  - `Guide`
  - `Unblock`
  - `Advance`
  - `Close`
  - `Hold`
- a stability threshold now preserves the current proposal family when the score edge is too small, reducing action jitter while the score model is still converging
- `/admin` and `/report` now surface unified score decomposition, candidate score surface, and tie-break context for the latest interviewer decision
- phase outcome:
  - `Phase 1 (v1)` is considered complete for this roadmap cycle
  - next focus shifts to `Phase 2: Reward System` for turn-level attribution and optimization loops

Success criteria:
- all decision paths converge through a single argmax model
- `decision_engine` is no longer primarily governed by ad-hoc branching
- `/admin` can explain the exact score decomposition behind any action

#### Phase 2: Reward System

Priority: `P1`

Core goal:
- let the system evaluate the quality of its own choices instead of only making them

Concrete work:
- implement `Reward v1` with:
  - `EvidenceGain`
  - `Redundancy`
  - `BadInterruption`
  - `FlowPreservation`
  - `CleanClosure`
- discretize evidence gain across:
  - reasoning
  - implementation
  - test
  - debugging
  - tradeoff
- add reward attribution per turn
- maintain a traceable chain:
  - `turn_id -> DecisionResult -> RewardResult`

Status: `Completed`

Phase 2 implementation summary:
- added `Reward v1` scoring in `src/lib/assistant/reward.ts` with:
  - `EvidenceGain`
  - `Redundancy`
  - `BadInterruption`
  - `FlowPreservation`
  - `CleanClosure`
- evidence gain is now discretized across:
  - reasoning
  - implementation
  - test
  - debugging
  - tradeoff
- assistant-turn and assistant-turn/stream now emit `REWARD_RECORDED` events when a decision exists
- reward events now carry trace metadata linking:
  - `transcriptSegmentId`
  - `decisionEventId`
- reward diagnostics are surfaced in:
  - `/admin` event descriptions and session timeline
  - `/report` evidence timeline and session reward summary/trend
- echo/non-answer handling is now integrated into the control path:
  - candidate echo detection in signal extraction
  - deterministic echo recovery prompts in decision logic
  - replayable events:
    - `CANDIDATE_ECHO_DETECTED`
    - `ECHO_RECOVERY_PROMPTED`
- policy regression now includes an `echo_recovery` scenario so the behavior is locked into scenario-based checks

Exit criteria met:
- bad behaviors now map to concrete penalties (for example repeated targets, interruption timing mistakes, and echo ignored cases)
- the system can trace downstream quality via:
  - `turn transcript -> decision event -> reward event`
  - replay-visible reward components and penalties in `/admin` and `/report`

Success criteria:
- every bad behavior can be mapped to a concrete reward penalty
- the system can explain which decision created a downstream problem

#### Phase 3: Temporal Dynamics

Priority: `P1.5`

Core goal:
- stop the system from stalling, looping, or reopening closed paths

Concrete work:
- add time decay to probing need
- strengthen flow-aware timing:
  - interruption penalty rises during coding
  - probe value rises during idle or stalled states
- make closure irreversible as a hard invariant:
  - once in `WRAP_UP`, probing or reopening is forbidden

Status: `Completed`

Phase 3 implementation summary:
- unified scoring now applies temporal probe decay after repeated recent probing streaks
- unified scoring now applies stronger interruption penalties during coding/debugging flow for non-hold actions
- unified scoring now increases probe value in idle + stalled/plateaued windows
- wrap-up irreversibility is hardened at scoring level by hard-masking not only `Probe/Guide/Unblock` but also `Advance` families once in `WRAP_UP`
- policy regression coverage now includes:
  - `idle_stall_probe_boost`
  - `wrap_up_irreversible`
- temporal diagnostics are now attached to decision payloads:
  - `temporalProbeStreak`
  - `temporalProbeDecay`
  - `temporalIdleLikely`
  - `temporalIdleProbeBoost`
  - `temporalCodingInterruptionPenalty`
- `/admin` and `/report` now surface temporal decision signals, so timing behavior can be audited instead of inferred

Success criteria:
- interviews move forward naturally
- the system does not get stuck in repetition loops
- wrap-up stays closed once reached

Exit criteria met:
- repeated probing pressure now decays deterministically across recent probe streaks
- interruption-heavy actions are penalized more aggressively during active coding/debugging flow
- idle/stalled windows now raise probe value to prevent silent stalling loops
- wrap-up closure is treated as irreversible at the unified scoring layer

#### Phase 4: Policy as Weight Sets

Priority: `P2`

Core goal:
- convert archetypes from stylistic labels into tunable score weights

Concrete work:
- parameterize policy into score weights
- let `Candidate DNA` modulate those weights deterministically
- compare policy behavior through score diffs on the same transcript

Status: `Completed`

Phase 4 implementation summary:
- policy presets now include explicit decision-score weight sets (`scoreWeights`) per archetype in `policy-config`
- unified decision scoring now consumes those weights for:
  - core score components (`need`, `timing`, `value`, `closure`)
  - temporal terms (`probe decay`, `idle probe boost`, `coding interruption penalty`)
  - action-family bias and proposal-bias scaling
- candidate DNA policy adaptation now deterministically modulates score weights in guided/challenging modes
- shadow-policy evaluation now emits score-diff payloads (actual vs shadow action-family scores), and `/report` + `/admin` expose those diffs for inspection
- policy regression lab now includes scenario-level score spread and per-archetype weight profile visibility for calibration sweeps
- report generation now includes replayable shadow-policy snapshot history (with top score deltas), not only the latest point-in-time payload
- latest decision views in `/admin` and `/report` now expose weight-profile metadata (core weights + dominant action bias + temporal weight knobs)

Exit criteria met:
- policy differences are visible in score composition, not just final wording
- behavior differences are explainable and replayable from both latest state and timeline snapshots

Success criteria:
- policy differences are visible in score composition, not just final wording
- behavior differences remain explainable and replayable

#### Phase 5: Policy Optimization Lab

Priority: `P2.5`

Core goal:
- move from “manually tunable” to “optimizable with evidence”

Concrete work:
- strengthen the policy regression lab with:
  - decision timelines
  - score diffs
  - reward diffs
- add reward-driven policy tuning loops
- expand golden scenarios:
  - strong candidate
  - stuck candidate
  - overconfident wrong answer
  - perfect flow

Status: `Completed`

Phase 5 implementation summary:
- policy regression lab now runs deterministic multi-turn micro-simulations for each archetype
- each result now includes a decision timeline with:
  - turn
  - action/target
  - total score
  - reward total
  - reward penalties
- scenario-level comparison now includes both:
  - score spread
  - reward spread
- policy lab now includes reward-driven tuning suggestions derived from penalty hotspots
- golden scenario set now explicitly includes:
  - `overconfident_wrong_answer`
  - `perfect_flow`
- `/admin` policy lab now surfaces:
  - average reward
  - cumulative reward
  - reward gap-from-best
  - per-archetype decision timeline cards
  - policy tuning suggestions with concrete weight-adjustment directions

Exit criteria met:
- policy tuning is no longer intuition-only because score/reward deltas and penalties are surfaced together
- policy changes can be evaluated against stable scenario sets with deterministic multi-turn outputs

Success criteria:
- policy tuning is no longer intuition-only
- policy changes can be evaluated against stable scenario sets

#### Phase 6: Voice and UX Convergence

Priority: `P3`

Core goal:
- polish delivery and UX without weakening committed truth or decision integrity

Concrete work:
- make thinking latency proportional to score complexity
- continue semantic silence handling for think-aloud cues
- keep TTS strongly bound to committed transcript output

Status: `Completed`

Phase 6 implementation summary:
- thinking lead-in latency now scales with decision complexity instead of only action label:
  - stream meta now emits `decisionComplexity`
  - lead-in delay now uses decision complexity + conversation health mode (`NORMAL/CONSTRAINED/GUIDED/RESCUE/TERMINATE_OR_REPLAN`)
- streaming voice delivery now emits a deterministic speech mode:
  - `stream_draft` for low-complexity turns
  - `commit_only` for high-complexity turns
- interview room TTS now honors speech mode:
  - in `commit_only`, the room does not speak stream deltas
  - it speaks only the final committed assistant transcript on `done`
- semantic silence handling was tightened:
  - browser speech auto-submit now correctly applies think-aloud/negative-intent bias in the non-provider branch as well

Exit criteria met:
- no transcript/voice truth-boundary regression in high-complexity turns because TTS can be forced to committed-only playback
- delivery pacing is now complexity-aware and still deterministic/replayable
- think-aloud protection remains active across both provider and browser-driven speech paths

Success criteria:
- no抢话 / double-voice / transcript mismatch regressions
- voice and UX polish never override truth or observability

### Global Guardrails

- `Complexity Guard`: anything that cannot be mapped into the score model should not be admitted into the decision surface
- `Idempotent Decision`: same input state should produce the same decision result
- `Anti-Repetition`: already-answered targets should collapse to zero or masked-out value in scoring
- `Budget Override`: when budget is exceeded, `Close` dominates the action space

### Convergence Principle

The next phase is not about making the interviewer merely “smarter.”

It is about making the system:
- stable
- tunable
- auditable
- optimizable
- replayable

### Generalization and Future Interview Modes

The current system generalizes well at the control-plane level, but not yet at the task-semantics level.

Practical interpretation:
- the interviewer OS is reusable
- the interview content model is still primarily optimized for algorithmic coding interviews

#### What Already Generalizes Well

These layers are strong candidates for reuse across future interview modes:
- `Truth Engine`
  - committed vs pending transcript boundaries
  - correction chains
  - committed-only downstream reads
- `Memory / Ledger`
  - evidence collection
  - answered targets
  - unresolved issues
- `Intent / Trajectory`
  - interviewer intent
  - candidate trajectory
  - flow / interruption reasoning
- `Policy / Invariants`
  - policy archetypes
  - invariant overrides
  - budget / anti-repetition / flow preservation
- `Critic / Admin / Report`
  - explainability
  - replayability
  - decision audit trails
  - evidence-backed reporting
- `Voice / Delivery`
  - committed transcript alignment
  - silence logic
  - think-aloud protection

In short:
- the orchestration layer is portable
- the interview-mode layer is not yet fully portable

#### What Is Still Coding-Interview Specific

These layers currently assume algorithmic problem-solving and would need adaptation for new interview types:
- `signal_extractor`
  - currently biased toward correctness, complexity, implementation, testing, and debugging
- `pass_conditions`
  - currently shaped around coding flow:
    - implementation
    - testing
    - wrap-up
- `rubric`
  - currently strongest for:
    - correctness
    - complexity
    - communication
    - independence / coachability inside coding tasks
- `editor / execution / starter code`
  - currently assumes code writing and code execution as the primary workspace
- `question bank schema`
  - currently built around algorithmic problems and coding-oriented metadata

#### If We Expand to System Design

Likely reusable:
- truth boundaries
- policy / invariants
- intent / trajectory
- critic
- snapshot / report / admin infrastructure

Likely new or heavily adapted:
- stage model
  - clarify
  - scope
  - architecture
  - deep dive
  - bottlenecks
  - tradeoffs
  - wrap-up
- signal model
  - requirements coverage
  - scale assumptions
  - component decomposition
  - bottleneck detection
  - failure-mode reasoning
- pass conditions
  - requirements complete
  - architecture coherent
  - bottlenecks discussed
  - tradeoffs justified
- rubric
  - architecture quality
  - scalability reasoning
  - operational thinking
  - communication under ambiguity
- room UI / workspace
  - diagram-first or outline-first
  - not code-editor-first

##### System Design Interviewer Execution Roadmap (v1)

Execution principle:
- maximize reuse of the existing coding interviewer control plane
- only add mode-aware adapters where system-design semantics are truly different
- keep decision/reward/report explainability unchanged (`snapshot -> decision -> reward -> report`)

Current implementation status (updated April 11, 2026):
- `Phase 0` completed
  - `SYSTEM_DESIGN` mode is wired from setup/session into assistant routing.
- `Phase 1` completed
  - six-stage state machine is active with `API_CONTRACT_CHECK` and on-demand `CAPACITY` gating.
- `Phase 2` completed
  - five design signals + evidence refs are extracted and recorded into snapshots/events with `/admin` visibility.
- `Phase 3` completed
  - system-design-specific decision actions and score routing are separated from coding flow with no-code invariant protection.
- `Phase 4` completed
  - reward/report now include system-design depth vs handwave attribution by turn and evidence type.
- `Phase 5` completed
  - report now emits System Design DNA dimensions with evidence pinning (`score -> snapshotId -> turnIds/evidenceRefs`).
- `Phase 6` completed
  - system design regression lab now includes `no_estimation`, `handwave`, and `strong_tradeoff` scenarios with decision timeline + score/reward diffs.
- `Phase 7` completed
  - Excalidraw whiteboard telemetry now emits weak signals (`component_count`, `connection_count`) as auxiliary-only events, explicitly excluded from core decision/reward truth paths.
- next active build target: post-v1 system design calibration and scenario expansion.

Phase sequence:

1. Phase 0 (`P0`) - Mode switch foundation
- wire `SYSTEM_DESIGN` mode end-to-end from setup -> session -> assistant pipeline
- verify mode is persisted and visible in runtime/session state
- DoD:
  - setup can start system-design sessions
  - session records show `mode=SYSTEM_DESIGN`
  - assistant pipeline branches on mode without coding regression

2. Phase 1 (`P0`) - Six-stage state machine
- add canonical design stages:
  - `REQUIREMENTS`
  - `API_CONTRACT_CHECK` (optional, prompt-dependent)
  - `CAPACITY` (on-demand)
  - `HIGH_LEVEL`
  - `DEEP_DIVE`
  - `REFINEMENT`
  - `WRAP_UP`
- stage semantics:
  - default path can go `REQUIREMENTS -> HIGH_LEVEL` without forced capacity
  - `API_CONTRACT_CHECK` is required only for API-centric product-design prompts
  - `CAPACITY` becomes mandatory once scaling/reliability/cost concerns are activated
- add stage inference + transition guard (forbid deeper scaling discussion before on-demand capacity pass)
- DoD:
  - stage progression is visible/auditable in `/admin`
  - flow can skip early capacity for non-scaling turns
  - once scaling context is active, flow cannot continue deep dive without capacity
  - stage reasoning is deterministic and explainable

3. Phase 2 (`P0`) - Signal extractor extension
- add design-specific signals:
  - `requirement_missing`
  - `capacity_missing`
  - `tradeoff_missed`
  - `spof_missed`
  - `bottleneck_unexamined`
- emit design signal snapshots with evidence references
- signal pass rules:
  - `requirement_missing=false` requires:
    - functional requirements coverage
    - scale context
    - at least one non-functional requirement
  - `capacity_missing` is evaluated as a required signal only after scaling context is activated
  - `API_CONTRACT_CHECK` evidence is evaluated when the prompt requires API definition
- DoD:
  - all five signals can be detected and tracked over turns
  - each signal has explicit evidence
  - signal state transitions are visible in `/admin`

4. Phase 3 (`P0`) - Decision engine extension
- add design actions:
  - `ASK_REQUIREMENT`
  - `ASK_API_CONTRACT`
  - `ASK_CAPACITY`
  - `PROBE_TRADEOFF`
  - `CHALLENGE_SPOF`
  - `ZOOM_IN`
- keep one unified score model (`argmax`) and add system-design boosts/penalties
- add `No Code Invariant` in system-design mode (forbid coding-implementation prompts)
- DoD:
  - interviewer asks API contract questions for API-centric prompts before high-level design
  - interviewer asks for QPS/scale when scaling context is active and capacity is missing
  - interviewer challenges hand-wavy tradeoffs and SPOF gaps
  - decisions remain score-decomposed and auditable

5. Phase 4 (`P1`) - Reward extension
- extend reward for system-design quality:
  - reward risk identification and tradeoff depth
  - penalize hand-waving
- keep turn-level attribution
- DoD:
  - system can distinguish deep design answers vs generic answers
  - reward outcomes are explainable by turn and evidence

6. Phase 5 (`P1`) - Report and DNA extension
- add design DNA dimensions:
  - requirement clarity
  - capacity instinct
  - tradeoff depth
  - reliability awareness
  - bottleneck sensitivity
- pin report scores to snapshot/turn evidence
- DoD:
  - report remains evidence-backed and auditable
  - strengths/weaknesses/recommendation are grounded in design evidence

7. Phase 6 (`P1.5`) - Regression lab
- add system-design scenarios:
  - no-estimation candidate
  - hand-wave candidate
  - strong tradeoff candidate
- compare decision timeline + score diff + reward diff across policies
- DoD:
  - policy behavior differences are observable and stable
  - no major behavior regression across scenarios

8. Phase 7 (`P2`, deferred) - Whiteboard integration
- add drawing UI as weak auxiliary signal only
- keep whiteboard telemetry outside core truth/decision invariants
- DoD:
  - whiteboard is available as UX aid
  - core decision integrity is unchanged

First implementation steps:
- Commit 1: system-design six-stage state machine (`stages.ts` + guards/tests)
- Commit 2: five design signals (`signal_extractor.ts` + snapshots/tests)

#### If We Expand to ML System Design

Everything above for system design still applies, plus ML-specific semantic layers:
- data pipeline reasoning
- feature freshness / training-serving consistency
- offline vs online evaluation
- model serving / latency / cost tradeoffs
- drift / monitoring / retraining strategy
- infra and product tradeoffs for ML systems

That means ML system design should be treated as its own interview-mode adapter, not as a small variation of algorithmic coding mode.

#### Expansion Principle

Future interview modes should reuse:
- truth
- policy
- intent
- trajectory
- critic
- snapshots
- report/admin infrastructure

But they should define their own:
- stage model
- signal extractor
- pass conditions
- rubric
- workspace / room UX

#### Working Conclusion

Current status:
- platform generalization: strong
- task-model generalization: partial

So future expansion should not rewrite the interviewer OS.
It should add a new mode adapter on top of the existing control plane.

### Follow-up TODOs

- `Wrap-up closure cleanliness`
  - when the candidate has already declared implementation complete and has already delivered a final summary, the interviewer should close cleanly instead of reopening with lines such as:
    - `feel free to proceed with your implementation`
    - `keep moving`
  - status:
    - `candidateDeclaredDone` / `implementationAlreadyDone` / `finalWrapUpDelivered` now feed memory + decision logic
    - regression coverage added so implementation done + summary done closes cleanly
- `Code-implementation probe trigger strengthening`
  - increase deterministic `Probe` priority when code-level risk signals appear, such as:
    - execution failures
    - missing boundary-case coverage
    - mismatch between claimed complexity and actual implementation pattern
  - add an advance/close guard so stage progression is blocked until at least one concrete implementation-focused follow-up has been asked when those signals are present
  - status:
    - pending
- `Echo / question-repeat handling`
  - when the candidate mostly repeats the interviewer question, classify the turn as `echo_or_non_answer` instead of treating it as neutral progress
  - require an immediate recovery action:
    - restate expected answer contract in one concise sentence
    - force a concrete prompt shape (`give pseudocode`, `walk one test case`, or `state time-space complexity`)
    - if repeated again, escalate pressure and narrow answer format
  - log explicit events for replay and policy tuning:
    - `CANDIDATE_ECHO_DETECTED`
    - `ECHO_RECOVERY_PROMPTED`
  - status:
    - completed in baseline form (`echo detection + constrained recovery prompts + replay events`)
    - keep tuning edge cases where candidates partially answer while repeating interviewer wording













