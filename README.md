# AI Interviewer

AI Interviewer is a voice-first mock interview platform for software engineering interview practice. It supports coding and system design interviews, tracks interview state through a structured decision loop, and generates evidence-backed feedback reports.

The project is built as a full-stack `Next.js + TypeScript` application with `Postgres`, `Redis`, `Prisma`, streaming assistant turns, transcript persistence, question-bank flows, and deterministic evaluation tooling.

## What It Does

- Runs coding interviews with a Monaco editor, opt-in sandboxed code execution, transcript history, and stage-aware interviewer turns.
- Runs system design interviews with target-level selection, stage rails, whiteboard workspace, and level-specific interviewer pressure.
- Generates reports with recommendation, score breakdowns, evidence pins, transcript drill-down, and system-design radar assessment.
- Provides an admin dashboard for session state, persona queue state, decision snapshots, monitoring baseline, and regression health.
- Supports browser voice interaction plus optional provider-backed STT.

## Architecture

- Frontend: `Next.js App Router`, React, TypeScript, Monaco editor, Excalidraw whiteboard.
- Backend: Next API routes, Prisma ORM, Postgres, Redis, BullMQ worker.
- AI orchestration: assistant turn generation, signal extraction, decision engine, pacing, pass conditions, reward attribution, and report generation.
- Evaluation: deterministic system-design scoring core, calibration packs, regression lab, drift snapshots, and CI gates.

Key entry points:

- [setup page](src/app/setup/page.tsx)
- [interview room](src/components/interview/interview-room-client.tsx)
- [assistant generation](src/lib/assistant/generate-turn.ts)
- [system design decisioning](src/lib/assistant/system_design_decision.ts)
- [report generation](src/lib/evaluation/report.ts)
- [unified scoring](src/lib/scoring/calculateUnifiedScore.ts)

## Core Technical Highlights

- Snapshot-first interview state: candidate state, interviewer decisions, intent, trajectory, and evidence are persisted and replayable.
- Mode-aware control flow: coding and system design share conversation-quality controls while keeping separate stage/action logic.
- System design interviewer: requirements, API contract, high-level design, optional capacity, deep dive, refinement, and wrap-up.
- Unified scoring core: deterministic scoring with signals, gaps, pivots, noise tags, hard caps, confidence, and explanations.
- Regression lab: replay scenarios for late bloomers, confident hand-wavers, rigid candidates, rescue-dependent candidates, and strong candidates.
- Real calibration pipeline: JSONL transcript labels can be replayed against unified scoring to measure accuracy and confusion matrices.
- Operational readiness: monitoring thresholds, release runbook, alert checker, optional `/admin` token gate, and optional mutation rate limits.

## AI Interviewer Decision Loop

The interviewer turn pipeline is intentionally structured rather than prompt-only:

1. Read committed transcript, recent events, current stage, code run state, and persisted snapshots.
2. Extract candidate signals and design/coding evidence.
3. Infer gaps, pass conditions, trajectory, pacing, and conversation health.
4. Score candidate actions and select the next interviewer move.
5. Generate or rewrite the assistant reply to match the selected action.
6. Persist transcript, events, snapshots, reward, and audit data.

This makes the interviewer inspectable in `/admin` and lets reports cite the evidence behind a recommendation.

## Data Model

Primary Prisma entities include:

- `InterviewSession`: selected mode, target level, question, persona settings, status, and metadata.
- `Question`: coding/system-design question bank entries with type, difficulty, tags, and company style.
- `TranscriptSegment`: user/AI/system turns with commit/refinement metadata.
- `SessionEvent`: stage transitions, decisions, rewards, hints, whiteboard signals, usage, and audit events.
- `CandidateStateSnapshot`, `InterviewerDecisionSnapshot`, `IntentSnapshot`, `TrajectorySnapshot`: replayable state snapshots.
- `EvaluationReport`: generated report JSON and recommendation.
- `InterviewerProfile` and `PersonaJobEvent`: optional public interviewer persona ingestion.

See [schema.prisma](prisma/schema.prisma) for the full schema.

## Test, CI, And Evaluation

Common checks:

```powershell
npm run build
npm run test
npx tsc --noEmit
npm run test:smoke
npm audit --omit=dev --audit-level=critical
npm run test:e2e
npm run eval:system-design
npm run eval:system-design:weekly
npm run eval:system-design:real -- --in data/system-design-calibration/real-transcripts.jsonl
npm run check:system-design-gates
npm run check:system-design-alerts
```

Notes:

- `npm run test` uses `scripts/run-vitest-safe.mjs` to work around occasional Windows `spawn EPERM` issues from the local `esbuild` process.
- `npm run build` requires local Postgres/Redis for routes that prerender or read live data.
- System design gates enforce calibration accuracy, regression pass rate, replay variance, and expectation flip thresholds.
- `.github/workflows/repository-quality.yml` runs install, Prisma generation/migrations/seed, the complete unit suite, TypeScript, production build, a critical-severity production dependency audit, and a dependency-backed core browser smoke test.

## Running Locally

1. Install dependencies:

```powershell
npm install
```

2. Start infra:

```powershell
docker compose up -d
```

3. Apply/generate Prisma state as needed:

```powershell
npm run prisma:generate
npm run prisma:push
npm run db:seed
```

4. Start the app:

```powershell
npm run dev
```

The development script binds to `127.0.0.1` by default. Keep it local; do not add a public bind, port mapping, tunnel, or reverse proxy without completing the sixth-batch hardening work.

5. Optional persona worker:

```powershell
npm run worker:persona
```

Open:

- Setup: [http://localhost:3000/setup](http://localhost:3000/setup)
- Questions: [http://localhost:3000/questions](http://localhost:3000/questions)
- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)

## Environment

See [.env.example](.env.example).

Important variables:

- `DATABASE_URL`
- `REDIS_URL`
- `LLM_PROVIDER`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `STT_PROVIDER`
- `ASSEMBLYAI_API_KEY`
- `ADMIN_DASHBOARD_TOKEN`
- `API_RATE_LIMIT_ENABLED`
- `ENABLE_CODE_RUNS` (default `false`)
- `ENABLE_HOST_CODE_EXECUTION` (default `false`; also requires `ENABLE_CODE_RUNS=true`)
- `ENABLE_PERSONA_INGESTION` (default `false`)
- `MAX_CODE_CHARS`, `MAX_STDIN_CHARS`, `MAX_TRANSCRIPT_CHARS`, `MAX_STT_AUDIO_BYTES`
- `MAX_PROVIDER_OUTPUT_CHARS`, `MAX_PERSONA_RESPONSE_BYTES`, `MAX_PROCESS_OUTPUT_CHARS`
- `MAX_CODE_TIMEOUT_MS`, `PROVIDER_TIMEOUT_MS`

## Security Boundary

Dangerous capabilities are fail-closed. Code runs and persona URL ingestion are disabled unless explicitly enabled. Code execution always attempts the network-disabled, resource-limited Docker runner first; it never falls back to a host process unless both code-run flags are enabled. Host children receive a minimal environment allowlist rather than application secrets.

These switches and deterministic size/timeout caps reduce accidental exposure; they are not a production sandbox, authentication layer, distributed quota system, or complete SSRF defense. The project is safe to defer full hardening only when the development server binds to localhost, is not port-mapped or reverse-proxied to the public internet, and no untrusted code or URLs are submitted. Do not expose this repository directly as a public demo. Public deployment requires the sixth-batch isolation, SSRF, authentication, distributed-rate-limit, and audit work.

## Known Limitations

- Some signal extraction still uses heuristic pattern matching when provider-backed extraction is unavailable.
- Browser speech recognition depends on Web Speech API support and varies by browser.
- Code execution and persona ingestion are disabled by default. Docker is required unless the explicit host fallback flag is also enabled.
- Real transcript calibration support exists, but production-quality calibration still depends on collecting enough labeled sessions.
- The current auth model is still demo-user oriented; production deployment should add real user/session auth before public launch.

## Detailed Docs

- [Full historical README/status archive](docs/project/README-full-status-2026-04-29.md)
- [Roadmap archive](docs/roadmaps/roadmap-archive-2026-04-12.md)
- [System design monitoring baseline](docs/operations/system-design-monitoring-baseline.md)
- [Go-live runbook](docs/release/go-live-runbook.md)
- [Real transcript calibration guide](docs/datasets/system-design-calibration/README.md)
