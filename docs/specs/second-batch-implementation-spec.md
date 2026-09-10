# 第二批实现级子规范：语义与可观测性闭环

状态：`APPROVED — 2026-09-09`  
关联基线：[repository-remediation-spec.md](repository-remediation-spec.md) 的 #8、#9、#11  
前置条件：第一批提交 `fb70519` 已完成

## 1. 范围与不变量

本批只处理三个问题：评分中 reward 的伪因果输入（#11）、系统设计监控产物的可用性/新鲜度语义（#8）、session snapshot 投影的降级可见性（#9）。不修改候选人评分算法、阈值、事件写入顺序、数据库 schema，也不引入第三批的跨实体 turn-commit 事务或通用幂等协议。本批允许四类 snapshot projection 自身使用局部数据库 transaction，以避免该读模型内部的部分写入；这不改变主 turn 的提交边界。

必须保持以下不变量：

1. `SessionEvent` 是面试事实的权威来源；snapshot 只是可重建的读模型，不能反向覆盖 event。
2. reward 不是候选人能力证据，不能影响 dimension score、cap、confidence、level 或 verdict。
3. “没有数据”绝不能被渲染或解释为数值 `0`、健康 `ok` 或空白的正常 session。
4. 缺表、临时数据库故障、产物缺失、产物格式错误与真实质量回归必须有不同的可观察状态。
5. 这批不自动修改历史数据，不执行 migration，也不引入公网级告警服务。

## 2. #11：Reward telemetry 的非因果契约

### 2.1 当前问题

`calculateUnifiedScore` 的 `prepareCleanContext` 接收并按 noise tag 过滤 `rewardTrace`，但 `aggregateDimensions`、pivot、gap、cap、confidence 和 verdict 均不读取它。这会让类型名暗示 reward 参与最终评估，实际却只是死输入。

### 2.2 目标模型

评分输入与 telemetry 输入必须分离：

```ts
type ScoringEvidence = {
  signals: Signal[];
  pivots: Pivot[];
  decisionTrace: DecisionTrace[];
  gapState: GapState;
  noiseTags: string[];
  metadata: ScoringMetadata;
};

type RewardTelemetry = {
  source: "session_event";
  causalRole: "interviewer_policy_only";
  entries: RewardTrace[];
  excludedByNoiseTags: string[];
};
```

- `calculateUnifiedScore` 只接收 `ScoringEvidence`；其导出结果与 `RewardTelemetry` 无类型依赖。
- `extractRewardTrace` 保留为 report 层的 telemetry 提取器，不再作为评分函数输入。
- report 在独立字段（命名为 `interviewerPolicyTelemetry.reward`）展示经过 noise filter 的 reward 条目、过滤原因与 `causalRole`；UI 文案不得称其为 score evidence、加分或扣分依据。
- 已过滤的 reward 只用于解释 interviewer policy 的运行情况，例如 hint/recovery 策略，不得被任何评分函数重新引入。
- 改动 report 输出形状前，必须审计 report API、report page、admin UI、持久化 report JSON 和测试 fixtures 的所有消费者；不存在读取旧 reward 字段的生产路径后，才能删除旧字段。兼容性策略必须在实现 PR 中明确，不得静默破坏既有 JSON consumer。

### 2.3 变更位置

- `src/lib/scoring/types.ts`：拆分评分证据与 telemetry 类型。
- `src/lib/scoring/calculateUnifiedScore.ts`：移除 `rewardTrace` 与其过滤逻辑。
- `src/lib/evaluation/report.ts`：在 report assembly 层构建并附加 `interviewerPolicyTelemetry`。
- 对应 scoring/report tests：改为显式验证 reward 的非因果性。

### 2.4 验收与测试矩阵

| 场景 | 断言 |
|---|---|
| 相同 `ScoringEvidence`，reward 从正变负 | score、caps、confidence、level、verdict 完全一致 |
| reward 带 noise tag | telemetry 标记过滤原因；评分结果不变 |
| 没有 reward event | telemetry 为空，report 与评分仍正常 |
| report 展示 reward | 字段带 `interviewer_policy_only`，不进入评分 explanation |
| 类型检查 | 不存在把 `RewardTrace` 传给 `calculateUnifiedScore` 的编译路径 |

## 3. #8：监控产物的 availability、validity、freshness 与 quality

### 3.1 版本化产物契约

weekly snapshot 改为版本化 envelope；writer 生成 `schemaVersion: 1` 的完整产物，reader 只接受已知版本。

```ts
type MonitoringEnvelopeV1 = {
  schemaVersion: 1;
  generatedAt: string; // ISO-8601 UTC
  calibration: { total: number; matched: number; accuracy: number };
  regression: {
    health: { passRate: number };
    stability: {
      maxScoreVariance: number;
      maxRewardVariance: number;
      expectationFlipCount: number;
    };
  };
};

type MonitoringAvailability = "available" | "missing" | "invalid" | "unsupported_version";
type MonitoringFreshness = "fresh" | "stale" | "unknown";
type MonitoringQuality = "ok" | "warning" | "critical" | "not_evaluated";
```

- `generatedAt` 必填、可解析、不得是未来超过五分钟的时间；所有指标必填且为有限数值。
- 默认最大年龄为 8 天，通过 `SYSTEM_DESIGN_MONITORING_MAX_AGE_HOURS` 覆盖；非法环境变量回退到 192 小时并输出配置错误状态，不静默接受。
- `available` 仅表示文件可读；`valid` 由完整 schema 验证隐含；`fresh` 仅在 valid 时可得；quality 仅在 fresh 时计算。
- 缺失、JSON 解析失败、缺字段、错误类型、未知 schema version、时间非法或 stale 都不得以 `0` 填充 metrics，也不得生成质量阈值告警。没有 `schemaVersion` 的历史产物归类为 `invalid`（缺少必填字段）；带有未知数值 schema version 的产物归类为 `unsupported_version`。

### 3.2 Reader 返回类型与 UI

`readSystemDesignMonitoringSnapshot` 不再返回 `MonitoringSnapshot | null`，改为总是返回：

```ts
type MonitoringReadResult = {
  availability: MonitoringAvailability;
  freshness: MonitoringFreshness;
  quality: MonitoringQuality;
  generatedAt: string | null;
  ageHours: number | null;
  source: { latestPath: string; datedPath: string | null };
  metrics: MonitoringMetrics | null;
  thresholds: AlertThresholds;
  alerts: MonitoringAlert[];
  diagnostics: string[];
};
```

- `alerts` 只包含已验证且 fresh 的质量阈值结果。
- Admin 总是渲染 monitoring panel：`missing`/`invalid`/`unsupported_version` 显示 telemetry unavailable，`stale` 显示 last generated time 与 age，fresh 才显示 quality badge 和指标。
- `latest.json` 与同日 dated snapshot 必须都通过 schema 验证；dated snapshot 缺失或 invalid 时 quality 为 `not_evaluated`，而不是把 calibration delta 设为零。

### 3.3 Writer、发布与 CLI

- `eval-system-design-weekly.ts` 先写入同目录唯一临时文件，完成 fsync/close 后原子 rename 到 dated path；验证 dated 文件后，再以同样方式发布 `latest.json`。失败时保留此前 valid latest，不发布半文件。
- `check-system-design-alerts.ts` 的退出码固定为：`0` = fresh 且 quality 非 critical；`1` = fresh 且 quality critical；`2` = telemetry missing/invalid/unsupported/stale 或 dated drift 不可用；`3` = 程序/配置错误。
- scheduled workflow 先运行 weekly writer，再运行 alert checker，避免每天先对昨日产物告警；手动 checker 继续可独立运行。
- README/operations 文档须解释 1、2、3 的 operator action：质量回归调查/回滚、数据管道修复、脚本或配置修复。

### 3.4 测试矩阵

| Fixture / 行为 | availability | freshness | quality | CLI |
|---|---|---|---|---|
| fresh、完整、阈值正常 | available | fresh | ok | 0 |
| fresh、完整、warning | available | fresh | warning | 0 |
| fresh、完整、critical | available | fresh | critical | 1 |
| `latest.json` 缺失 | missing | unknown | not_evaluated | 2 |
| JSON 损坏/字段缺失/NaN | invalid | unknown | not_evaluated | 2 |
| schema version 未知 | unsupported_version | unknown | not_evaluated | 2 |
| generatedAt 过期 | available | stale | not_evaluated | 2 |
| 同日 drift 文件缺失或无效 | available | fresh | not_evaluated | 2 |
| writer 在发布前失败 | 上一个 valid latest 保持可读 | — | — | — |

## 4. #9：Snapshot 投影健康、失败与恢复

### 4.1 权威边界

`SessionEvent` 及已提交 transcript 是报告、replay 与评分事实的唯一权威。`CandidateStateSnapshot`、`InterviewerDecisionSnapshot`、`IntentSnapshot`、`TrajectorySnapshot` 是加速读取的 materialized projections；写失败不得改变已提交的 event 或 user-visible assistant reply。

### 4.2 写入契约

`persistSessionSnapshots` 改为返回显式结果，而不是 `void`：

```ts
type SnapshotWriteStatus = "persisted" | "skipped" | "degraded";
type SnapshotFailureKind = "schema_missing" | "transient_database" | "serialization" | "unknown";

type SnapshotWriteResult = {
  status: SnapshotWriteStatus;
  attemptedKinds: SnapshotKind[];
  persistedKinds: SnapshotKind[];
  failure?: { kind: SnapshotFailureKind; message: string };
};
```

- 同一 turn 的多个 snapshot insert 必须用单个 Prisma transaction 执行：全部成功才为 `persisted`；任一失败时 transaction rollback，`persistedKinds` 为空。这只保证 projection 的内部原子性，不将 event/transcript/snapshot 合并为第三批才处理的跨实体 turn-commit transaction。
- 不再设置 `snapshotPersistenceDisabled` 这类进程级永久开关。每次未来写入仍尝试；缺表错误可按进程去重日志，但不能阻止恢复后的重试。
- route 在 event 已落库后调用 snapshot projection；获得 `degraded` 时继续完成主请求，但 best-effort 记录一次结构化 `SNAPSHOT_PROJECTION_DEGRADED` 事件，payload 仅含 kind、attemptedKinds 和安全诊断码，不含数据库错误文本或候选人内容。该事件写入必须独立 `try/catch`；它自身失败时只能输出结构化日志，绝不能使主请求失败或重新抛出数据库错误。
- 若同一主请求已有 degraded event，重试不得无限追加：临时去重键固定为 `(sessionId, sourceSessionEventId, "SNAPSHOT_PROJECTION_DEGRADED")`，其中 `sourceSessionEventId` 是本次 projection 前已经持久化的 `SessionEvent.id`。不得在本批创建或传递 `turnId`；实现处必须注释该 route-local 去重将由第三批通用 idempotency key 替换。

### 4.3 读取、Admin 与 report

四个 array-returning reader 改由一个 bundle reader 统一返回：

```ts
type SessionSnapshotBundle = {
  candidateStates: CandidateStateSnapshotRow[];
  decisions: InterviewerDecisionSnapshotRow[];
  intents: IntentSnapshotRow[];
  trajectories: TrajectorySnapshotRow[];
  health: {
    status: "healthy" | "degraded";
    failure?: SnapshotFailureKind;
    diagnostics: string[];
  };
};
```

- 读取失败绝不以“正常空数组”单独返回；bundle 带 `health.degraded`。
- Admin、report 页面和 report API 显示/返回 snapshot health。仅在 health healthy 时将 snapshot 作为加速读；degraded 时从 event/transcript 重建候选状态、decision、intent、trajectory，或明确标为 unavailable。不得只为 signals/decisions 做 fallback 而让 intent/trajectory 静默消失。
- 本批提供一个内部 `rebuildSessionSnapshotBundleFromEvents(sessionId)`：从事件流构建四类 projection 的输入并写入 snapshot transaction。它只接受服务端 event，不能被公共 API 调用；缺少足够事件时返回明确 unavailable，不伪造 projection。

### 4.4 测试矩阵

| 场景 | 写入结果 | 读取/Admin 行为 |
|---|---|---|
| 四类 snapshot 成功 | `persisted`、全部 kind | healthy，读取 rows |
| 缺表 | `degraded/schema_missing`、transaction rollback | degraded，可恢复后下一次写重试 |
| 临时 DB 错误 | `degraded/transient_database` | degraded，不永久关闭；后续写可成功 |
| 第三项 insert 失败 | 无部分 rows，degraded event 一次 | degraded，不显示部分投影为完整 |
| degraded event 写入也失败 | 主请求仍成功；结构化日志一次 | snapshot health 仍以原始 projection result 为 degraded |
| query 失败 | bundle health degraded | Admin/report 显示 unavailable 或 event rebuild |
| 进程重启后 migration 已补齐 | 后续写为 persisted | health 恢复 healthy |
| rebuild 完整 event | 四类 projection 重新写入 | healthy bundle |
| rebuild 事件不足 | 明确 unavailable | 不虚构 intent/trajectory |

## 5. 实施顺序与文件清单

1. #11：先拆分评分输入和 report telemetry，锁定“reward 不影响 verdict”的性质测试。
2. #8：实现 reader/envelope/fixtures，再更新 writer、CLI、workflow 和 Admin 文案。
3. #9：实现 snapshot result/bundle/transaction/fault tests，最后接入 assistant-turn、Admin 与 report readers。

预期修改文件：

- `src/lib/scoring/{types.ts,calculateUnifiedScore.ts,calculateUnifiedScore.test.ts}`
- `src/lib/evaluation/report.ts` 及 report tests
- `src/lib/operations/system-design-monitoring.ts`、其 tests、`src/scripts/{eval-system-design-weekly.ts,check-system-design-alerts.ts}`
- `.github/workflows/system-design-monitoring.yml`、`src/app/admin/page.tsx`、operations 文档
- `src/lib/session/snapshots.ts`、新增 fault tests、assistant-turn routes、`src/lib/admin/ops.ts`、report API/page

## 6. 退出标准

- 本子 spec 经 review 明确批准后才开始第二批业务代码。
- #11、#8、#9 的所有测试矩阵场景都有自动测试；无以 warning log 代替健康状态的路径。
- 全量 unit、类型检查、production build、system-design gates 通过。
- 更新基线 spec 的执行记录，列出文件、测试、监控 CLI 退出码及已知延期项。
