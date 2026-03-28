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
- Lightweight evaluation/report v0 with stage journey, replay markers, dimension scores, strengths, weaknesses, and actionable improvements
- Evidence-based report pipeline with candidate-state snapshots, interviewer decisions, and shared replay evidence across report and admin
- Default interviewer skills layer for tone, pacing, follow-up discipline, and coaching-without-spoiling
- Browser voice loop with interruption handling, continuous listening, and turn-taking policies
- Dedicated STT handoff for spoken candidate turns, with provider selection and browser transcript fallback
- Dedicated STT-backed voice mode with provider-led turn detection, provider preview drafts, usage logging, low-cost mode controls, and switchable STT providers
- `Vitest` unit/route tests and `Playwright` end-to-end tests

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
- Gemini/OpenAI replies are now explicitly steered by the decision engine and post-processed to fall back to the required decision question when a model reply is too generic.
- Text-provider fallback is now an explicit sequence: preferred provider -> secondary provider -> local fallback.
- /admin now exposes latest session stage, latest candidate state, latest interviewer decision, and a dedicated session-state timeline.
- /report/[id] now shares the same evidence backbone as /admin, including signal snapshots, interviewer decisions, hints, stage transitions, and code-run outcomes.
- Added tests for signal extraction, decision logic, evidence-based reporting, provider compliance handling, and provider fallback ordering.

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
- `src/lib/assistant/policy.ts`: explicit stage policy, exit criteria, hint escalation, and prompt strategy selection
- `src/lib/assistant/generate-turn.ts`: multi-provider assistant turn generation, provider sequencing, and decision-compliance enforcement
- `src/lib/usage/cost.ts`: rough token/audio cost estimation and session usage summaries
- `src/lib/evaluation/report.ts`: evidence-based report generation and session feedback scoring
- `src/lib/persona/queue.ts`: BullMQ queue helpers
- `src/lib/persona/fake-ingestion.ts`: local persona ingestion simulation
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

- Persona ingestion is still simulated; it does not yet fetch and summarize real public web pages
- Realtime AI conversation is still browser speech recognition plus `SSE` streaming rather than a full duplex low-latency voice stack
- Browser speech recognition depends on Web Speech API availability and varies by browser
- Dedicated STT and provider-first voice mode now support a switchable provider layer, with OpenAI and AssemblyAI options
- Gemini and OpenAI interviewer turns can still hit provider rate limits; when that happens the system falls back to local interviewer heuristics
- LLM-backed signal extraction uses the same provider availability rules, so observer quality may also degrade to heuristics under provider failure or rate limits
- Live provider drafts are periodic previews rather than true token-level streaming ASR
- Code execution is local-process based and currently supports Python and JavaScript only
- Authentication is still stubbed around a demo user
- Evaluation/report is intentionally lightweight v0 and should still become more rubric-driven over time
- Replay is currently heuristic and event-driven, not yet a full stage-grouped interview playback view
- Prisma generation on Windows can fail if `dev` or `worker` processes are locking the Prisma engine file

## Next Recommended Work

### Product and Backend

- Group report replay by stage and add richer per-stage evidence
- Push LLM-backed signal extraction deeper and persist candidate-state snapshots outside the event stream
- Replace fake persona ingestion with real public-page fetching, extraction, and summarization
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





