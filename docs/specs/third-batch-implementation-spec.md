# 第三批实现级子规范：权威边界、逻辑动作一致性与证据裁决

状态：`APPROVED — 2026-09-09`
关联基线：[repository-remediation-spec.md](repository-remediation-spec.md) 的 #5、#6、#10
前置提交：第二批 `62fe34d`

## 1. 范围、顺序与不可变约束

本批只处理三件事：收紧公共写接口的权威边界（#5）、为逻辑动作建立幂等/事务/序列契约（#6）、让 signal/ledger/health 消费同一份可重放裁决（#10）。实施顺序固定为 #5 → #6 → #10；不得在本批引入认证、跨用户授权、评分阈值调整或公网限流。

不变量：

1. `SessionEvent` 与已 committed 的 transcript 是事实来源；派生 report、snapshot、ledger 均不可反向改写它们。
2. 客户端永远不能写 AI/SYSTEM transcript、interviewer decision、reward、assessment、lifecycle 或 report 事实。
3. 相同 `turnId` 的重试必须得到相同逻辑结果；不同 `turnId` 才能产生新事实。
4. 更正 transcript 必须写入新 `segmentIndex`，`correctionOfId` 仅通过 event 关联旧版本，绝不复用 index。
5. provider 原始观察不是事实；只有 adjudicated assessment 可驱动 ledger、conversation health 与后续 policy。

## 2. #5：公共 API 的客户端/服务端权威边界

### 2.1 白名单

公共 `POST /api/sessions/[id]/events` 仅接受：

- UI telemetry：`INTERVIEW_ROOM_OPENED`、`LISTENING_STARTED`、`LISTENING_STOPPED`、`HINT_REQUESTED`、`EDITOR_ACTIVITY_RECORDED`、`WHITEBOARD_SIGNAL_RECORDED`、`CANDIDATE_TURN_AUTOSUBMITTED`、`AI_INTERRUPTED_BY_CANDIDATE`；payload 必须采用每种事件独立 schema，禁止任意 JSON。后两类只能记录客户端 UI/流状态（例如 auto-submit source、interruption 时的 boolean 状态），标记为非因果 telemetry；不得携带 candidate text、stage 决策、评分、reward 或任何可被 policy/ledger/health 当作候选人能力证据的字段。
- 候选人事实不通过通用 event route 写入；只由 transcript route 的 `speaker: USER` 命令生成 `CANDIDATE_SPOKE` 等 server-owned event。

`QUESTION_SHOWN` 与 `STAGE_ADVANCED` 明确为 server-owned lifecycle 事实：客户端停止向通用 event route 发送它们，分别由服务端的 question presentation / stage-transition command 在满足既有条件时写入。移除客户端 `STAGE_ADVANCED` 发送前，必须逐一比对客户端当前发送该事件的全部时机，确认 server stage-transition command 在每个对应时机都会产出同一 lifecycle 事实；任何尚未覆盖的转换必须先补齐 server command 与测试，再删除客户端发送。显式拒绝所有其他 `SESSION_EVENT_TYPES`，特别是 `AI_SPOKE`、`DECISION_RECORDED`、`REWARD_RECORDED`、`SIGNAL_SNAPSHOT_RECORDED`、`EVALUATION_STARTED`、`REPORT_GENERATED`、`SNAPSHOT_PROJECTION_DEGRADED`。拒绝返回 403/422，且 session/event/transcript 均无副作用。

公共 transcript route 只允许 `USER`。AI/SYSTEM transcript 的写入移入仅 server-importable 的 command/module；route schema 与内部 command 入参分别定义，禁止为“复用”而向 public schema 放宽 `speaker`。

实现前必须枚举当前所有客户端 `POST /events` 调用，逐个记录为“白名单内”或“已迁入 server command”；同时验证 `CANDIDATE_SPOKE` 从 transcript route 产生后，commit-arbiter 与 signal extraction 仍能收到该事实。

### 2.2 验收

- 伪造 AI/SYSTEM transcript、decision/reward/report event 分别返回 4xx 且 create mock 未调用。
- 合法 USER transcript、允许的 telemetry 与既有 UI 调用保持成功。
- report/admin/replay 仅读取 server-created authoritative event；测试不得通过 public route 构造评分事实。
- 迁移后，原本由客户端驱动的每个 stage-transition 时机仍由服务端产出对应 `STAGE_ADVANCED`；每个时机均有自动化回归测试，且不存在跃迁丢失。

## 3. #6：turn 命令、事务、幂等与唯一序列

### 3.1 `turnId` 协议

`src/components/interview/interview-room-client.tsx` 在发起 assistant-turn 前用 `crypto.randomUUID()` 创建 `turnId`，保存在该 pending command 对象中；网络 retry、stream reconnect 和同一 UI action 必须复用它，用户再次点击才生成新 key。两个 assistant-turn route 只接受 body `turnId`，按 UUID 格式校验后传入 server command；禁止 header 备选协议。重复请求在 commit 进行中统一返回 `202` 与 `{ status: "in_progress", turnId, retryAfterMs }`，已完成则返回已持久化 result。

服务端为 assistant turn 建立 `SessionTurnCommit`（或等价表，具体表名在 migration 前确认）并含：`sessionId`、`turnId`、`status`、`responseTranscriptId`、`resultJson`、`createdAt`；unique `(sessionId, turnId)`。重复请求：已完成返回持久化 result，进行中统一返回 `202` 与 `in_progress` payload，绝不再次调用 provider 或重复写 event。

### 3.2 事务边界

provider/LLM 调用必须在任何长期数据库 transaction 外：先以短 transaction claim 或读取 `turnId` 状态；再在 transaction 外调用 provider；最后仅以短 transaction 原子写入 AI transcript、server events、stage/session update 和 turn result。不得在持有数据库 transaction/行锁期间等待 provider。snapshot 是第二批定义的可重建 projection，严格在权威 commit 后执行，不属于该 transaction。

streaming 明确分两阶段：先 claim `turnId`；网络向客户端发送 delta 后不能假装可回滚。只有 final result 才能在一次 commit transaction 中写入 transcript/events/result；abort 保留 `ABORTED` 或 `FAILED` commit record，不写半个 authoritative AI transcript。retry 按同一 key 返回已完成结果或可恢复状态。

### 3.3 序列与 migration

为 `TranscriptSegment @@unique([sessionId, segmentIndex])` 和 `CodeSnapshot @@unique([sessionId, snapshotIndex])` 添加 migration。分配必须在 transaction 内，使用数据库原子 allocation 或 unique-conflict retry；禁止 route 先读 max、在 transaction 外加一。

migration 前运行只读重复预检：按 session 查询重复 segment/snapshot index，记录结果。若本地 dev 数据有重复，先备份后确定性清理或明确重建 dev DB；生产数据不得擅自删除。验证 correction 始终使用新 index。

### 3.4 验收

- 并发同 key 与串行 retry：仅一个 provider invocation、一个 AI transcript、一个逻辑 event bundle。
- 不同 key：两个独立逻辑动作。
- transaction 内第 N 个写失败：无 authoritative 半成品；snapshot 降级不回滚已完成权威 turn。
- 并发 USER transcript/code snapshot 分配不产生重复 index；unique migration 被数据库实际拒绝重复。
- stream final/abort/retry 有 route integration 测试。

## 4. #10：turn-keyed、可重放 assessment

### 4.1 数据模型

新增 append-only `TurnAssessment`：`id`、`sessionId`、`candidateTurnId`、`assessmentVersion`、`status`、`heuristicJson`、`providerJson`、`adjudicatedJson`、`evidenceJson`、`createdAt`，unique `(sessionId, candidateTurnId, assessmentVersion)`。`candidateTurnId` 固定为触发本次评估的最后一条 committed、final `USER` transcript id；partial、superseded 或后续无关 USER 片段都不得作为该 key。`evidenceJson` 至少保存 transcript id、start、length、excerpt hash/受限 excerpt；禁止保存 provider secret 或不受限原始响应。

本批仅为新 turn 写 assessment，不回填历史 session。历史或异常 turn 缺 assessment 时，ledger/health 必须显式降级为 unavailable 或使用保守的既有权威 event fallback；不得抛错，也不得把缺失解释为“无信号/健康”。

`adjudicatedJson` 是唯一给 `memory_ledger`、`conversation_health`、policy/reward 输入的结构，包含每个 signal 的 value/source/confidence、fallback reason、版本。provider 与 heuristic 冲突用确定性规则裁决，provider 无效 JSON/超时自动回退 heuristic 并留下原因。

### 4.2 supersession 与 replay

assessment 不 update 覆盖；重算创建更高版本。消费者默认取每个 `(candidateTurnId)` 最大合法版本。replay 仅输入 committed transcript + server events，以稳定排序产生同一 adjudicated output、ledger 和 health；重复 event 不得二次计分。echo 同一 turn 只能以 assessment 中的一个 canonical marker 影响 health，不能再叠加 snapshot/event/相邻文本的重复 penalty。

### 4.3 验收

- provider/heuristic 冲突、provider invalid JSON、provider fallback、真实复述与错误 echo fixtures 都确定。
- 同一事件流 replay 两次的 assessment、ledger、health 完全相等；重复 event 不改变结果。
- assessment version supersession 不改旧记录，默认消费者选最新版本。

## 5. migration、测试与交付顺序

1. #5 schemas/routes/route integration tests。
2. #6 先写 migration preflight + schema，再 client key、server command、non-stream/stream tests。
3. #10 schema/migration、adjudicator、consumer cutover、replay fixtures。

每个 migration 在本地执行前必须保存 preflight 输出。新增测试至少覆盖第 2–4 节全部矩阵；特别是 #6 的并发同 key、transaction 第 N 写失败、stream abort/retry，以及 #10 的 replay 幂等必须有真实自动测试，不能以类型检查或 build 代替。最后执行全量 unit、`npx tsc --noEmit`、production build。更新基线 spec 的第三批执行记录后才允许提交。

## 6. 明确不做

- 不把 turnId 扩展为跨用户身份或认证 token。
- 不修改评分阈值、reward 非因果边界或第二批 snapshot health 契约。
- 不公开 endpoint、不添加外部 outbox broker；stream 的恢复语义先以数据库 turn-commit 为准。

## 7. 执行记录（2026-09-10）

- #5、#6、#10 已按本子规范完成；数据库 migration 已应用至 `20260910010000_turn_assessments`。
- #10 使用 `TURN_ASSESSMENT_RECORDED` 将 append-only assessment 的最高合法版本投影到既有 event replay 输入；ledger、signal trend 与 conversation health 不再读取旧 signal snapshot 作为历史能力证据。
- 缺 assessment 的旧 session 不回填：ledger/health 返回 `assessmentStatus: "unavailable"` 并保守运行。echo health 仅按每个 candidate turn 的最新 adjudicated marker 计数，重复 assessment event 和旧 echo event 不叠加。
- 实库验证：assessment 重复版本被 P2002 拒绝，旧版本未覆盖，默认最新版本为 v2；验证产生的临时 user/session 已清理。
