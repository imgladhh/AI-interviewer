# 统一评分裁决与校准实现规范

状态：`PHASE A COMPLETE — PHASE B NOT STARTED — 2026-09-11`
范围：系统设计报告的最终等级、verdict、置信度与证据充分性
关联：`src/lib/scoring/*`、`src/lib/evaluation/report.ts`、真实转录校准工具

## 1. 问题与目标

当前系统设计报告并存两条等级路径：

1. `buildSystemDesignDna` 先以五个维度的平均值调用 `applySystemDesignLevelCap`，并将结果写入 `levelRecommendation`。
2. 同一函数又调用 `calculateUnifiedScore`，返回 `rawLevel`、`cappedLevel`、`verdict`、`confidence` 与 `appliedCaps`。

这两条路径可在边界样本上给出不同的最终解释。`levelRecommendation` 是旧的 report-local 规则，而 unified scorer 是具备 score、cap、confidence 与校准工具的独立规则。报告不能同时把二者作为最终结论。

本改动的目标是建立唯一、可重放、可校准的 `ScoreAdjudication`：

- `rawLevel` 表示评分公式下的未受限能力估计；它不是最终建议。
- `cappedLevel` 是唯一可转换为候选人等级与 verdict 的能力结论。
- hard cap 是非补偿性的；pivot、强项或低噪声不得绕过已触发的 cap。
- `confidence` 只描述结论可信度，不得隐式升级或降级 `cappedLevel`。
- Phase B 经 review 并启用 enforced 后，证据不足或输入退化必须显式拒绝最终 hire/no-hire，而不是以低 confidence 的确定 verdict 掩盖不确定性。
- reward 继续是 `interviewer_policy_only` telemetry，不能进入此裁决。

本规范不调整现有 dimension、gap、pivot、cap 或 confidence 的数值阈值。§3.1 的证据充分性常量是新增的、尚未校准的 **provisional v1 policy**，不得与现有评分阈值混称，也不得在完成 evidence-link 验证和 coverage review 前启用为生产拒判门。

实施拆成两个独立可验收阶段：

- Phase A：只统一等级路径，立即修复双权威 bug。`cappedLevel` 成为唯一候选人可见等级，legacy 逻辑最多作为 Admin-only shadow。
- Phase B：先以 shadow 模式计算证据充分性，验证 evidence-link 与拒判率；只有人工 review 明确批准后才允许把它切换为 enforced 并令候选人可见 verdict 为空。

## 2. 权威与不变量

1. 已提交的 transcript、server-owned events 和最新有效 turn assessment 是事实来源；snapshot 只是读模型。
2. `calculateUnifiedScore(ScoringEvidence)` 是唯一的候选人能力计算器。
3. 只有 `ScoreAdjudication` 能产生报告中的候选人等级、候选人可见 verdict 和“是否可作最终决定”状态。
4. `applySystemDesignLevelCap` 不得继续生成面向用户的最终等级；迁移期只能产生 shadow comparison，不得影响裁决。
5. 不存在 `FINAL` 且 `cappedLevel` 与 report level 不一致的输出。
6. 相同版本的事实输入必须生成位级相同的 adjudication；事件顺序无关的数组须在进入 scorer 前稳定排序。
7. `PARTIAL_TRANSCRIPT`、`STT_CORRUPTION`、`INTERRUPTED_TURN` 不得产生 pivot 加分；现有 scorer 的零 pivot adjustment 行为保持。
8. 无 evidence ref、无 candidate turn，或关键证据只来自退化输入时，不得将缺口“补全”为通过。

## 3. 数据契约

在 `src/lib/scoring/types.ts` 新增：

```ts
export type AdjudicationStatus = "FINAL" | "INSUFFICIENT_EVIDENCE" | "DEGRADED_INPUT";
export type DecisionabilityMode = "shadow" | "enforced";

export type EvidenceSufficiency = {
  explicitSignalCount: number;
  requiredSignalCount: 5;
  evidenceRefCount: number;
  candidateTurnCount: number;
  keyDimensionsWithDirectEvidence: Array<
    "capacity_instinct" | "tradeoff_depth" | "bottleneck_sensitivity"
  >;
};

export type ScoreAdjudication = {
  schemaVersion: 1;
  scoringVersion: "unified-v1";
  decisionabilityMode: DecisionabilityMode;
  status: AdjudicationStatus;
  rawLevel: UnifiedLevel;
  cappedLevel: UnifiedLevel;
  scoredVerdict: UnifiedVerdict;
  candidateFacingVerdict: UnifiedVerdict | null;
  confidence: number;
  appliedCaps: string[];
  sufficiency: EvidenceSufficiency;
  blockingReasons: string[];
  result: EvaluationResult;
};
```

`scoredVerdict` 必须始终等于 `levelToVerdict(cappedLevel)`，用于诊断和校准；调用方不得从 `rawLevel` 反推 verdict。`candidateFacingVerdict` 的规则是：

- shadow：始终等于 `scoredVerdict`，但报告/Admin 同时记录观测到的 status，不产生拒判行为；
- enforced：`FINAL` 时等于 `scoredVerdict`，其他状态为 `null`。

Phase A 固定使用 shadow。只有 §3.2 的链路验证和 §6 的 coverage review 通过后，才可将 Phase B 切换为 enforced；切换必须是显式、版本化代码变更，不能通过未审计的环境变量静默完成。

### 3.1 Provisional v1 充分性规则

这是待校准的结论资格 policy，而非分数修改器。以下 `3/3` 与关键三维规则是初始假设，不代表已有数据支持：

- `DEGRADED_INPUT`：存在任一 noise tag，或 snapshot/assessment health 不是 healthy。shadow 只记录状态；enforced 时 `candidateFacingVerdict = null`。
- `INSUFFICIENT_EVIDENCE`：没有 candidate turn、显式 signal 少于 3、有效 evidence refs 少于 3，或 capacity/tradeoff/bottleneck 三项中没有任何一项有 direct evidence。shadow 只记录状态；enforced 时 `candidateFacingVerdict = null`。
- `FINAL`：不属于上述状态。即使出现 hard cap 也可 final；cap 是能力缺口，不能与证据不足混淆。

direct evidence 指能解析到 committed candidate turn 的 evidence ref；“No direct candidate evidence …”、AI turn、snapshot ID、本地推断文字和白板 telemetry 都不计入。该解析必须是保守的，无法解析时视为无 direct evidence。

`DEGRADED_INPUT` 优先于 `INSUFFICIENT_EVIDENCE`，以便操作者先修复数据完整性；`blockingReasons` 必须同时保留两类原因，报告不能丢失次级问题。

### 3.2 Evidence-link 前置验证

实施 Phase B 前必须先验证评分路径确实拥有稳定、可校验的 candidate-turn 关联。当前代码审计结论是：

- `signal_extractor.ts` 的 per-signal `evidenceRefs` 是 `USER#<ordinal>: <snippet>`，不是 transcript ID；ordinal 会受过滤、历史导入和 transcript 版本影响。
- `TurnAssessment.evidenceJson` 保存稳定的 `transcriptId`、offset、length、excerpt/hash，但 `TURN_ASSESSMENT_RECORDED` event 当前不包含该 evidence 对象。
- `report.ts` 优先读取 candidate snapshot，fallback 到旧 `SIGNAL_SNAPSHOT_RECORDED`；它没有读取 `TurnAssessment.evidenceJson`，因此不能从评分 signal 可靠证明其来自 committed candidate turn。
- `buildTextPointers` 对解析失败存在宽松 fallback，甚至可落到非 USER transcript；该函数适合展示，不得直接作为充分性判定依据。

在启用 enforced 前，必须选择并实现一个 canonical link：优先让 report API 查询最新有效 `TurnAssessment` rows，并将其 `candidateTurnId + evidenceJson.transcriptId/span/hash + adjudicated per-signal evidence` 传给 scoring assembly。若仍通过 event replay，则 canonical event 必须携带同等结构化 evidence，并保持 append-only version 语义。不得把 `USER#n` 或 snippet 文本当数据库主键。

前置验收必须证明：

1. assessment 的 `candidateTurnId` 与 `evidenceJson.transcriptId` 指向同一条 committed final USER transcript；
2. superseded assessment 只采用最高版本；correction 使用新 transcript ID，不复用旧证据；
3. 每个计为 direct evidence 的 signal 都能解析到 USER transcript 的有效 span，hash/边界不匹配时 fail closed；
4. snapshot healthy/degraded、event replay 与直接 DB reader 对同一 session 得到一致的 direct-evidence 集合；
5. 对现有本地报告样本运行 dry-run，输出 `linkSuccessRate`、无法解析原因分布和按维度覆盖率。链路成功率未经 review，不得进入 enforced。

## 4. 实现设计

### 4.1 单一入口

新增 `src/lib/scoring/adjudicate-score.ts`：

```ts
export function adjudicateScore(input: {
  evidence: ScoringEvidence;
  inputHealth: "healthy" | "degraded" | "unavailable";
  candidateTurnCount: number;
  decisionabilityMode: "shadow" | "enforced";
}): ScoreAdjudication;
```

该函数按固定顺序：

1. 调用 `calculateUnifiedScore` 一次；不复制或重写 dimension/cap/pivot/gap 计算。
2. 从已清理的 evidence 和 signal evidence refs 导出 `EvidenceSufficiency`。
3. 计算 status 与稳定、面向用户的 blocking reasons。
4. 始终保留 `scoredVerdict`；仅在 enforced 且非 `FINAL` 时置空 `candidateFacingVerdict`。Admin/replay 必须同时显示 mode、status 和 result。

`calculateUnifiedScore` 继续是纯函数，保持其公开的低层测试；`adjudicateScore` 才拥有“是否能下最终结论”的策略。

### 4.2 报告集成

`buildSystemDesignDna` 构造完整 `ScoringEvidence` 后调用 `adjudicateScore`，并只从其读取：

- `levelRecommendation`：Phase A 和所有 `FINAL` 由 `cappedLevel` 映射；仅在 enforced 且非 `FINAL` 时为 `null`，替换现有必填字符串类型。
- `rawLevel`、`cappedLevel`、`scoredVerdict`、`candidateFacingVerdict`、`confidence`、`appliedCaps`、`whyNotHigher`。
- 新增 `adjudication` 字段，供 API/UI 直接使用。

报告 JSON 的兼容性：保留旧顶层 `levelRecommendation` 一次小版本发布，但允许为 `null`；新增 `adjudication.schemaVersion`。所有 report page、report API、Admin 和测试 fixture 必须接受 null。shadow 模式必须明确显示“充分性规则观测中，尚未用于拒判”；enforced 且非 `FINAL` 时显示“证据不足/输入退化，未给出最终建议”，不得回退显示 raw 或 legacy level。

迁移期可输出仅供 Admin 的：

```ts
legacyShadow?: { level: "Mid-level" | "Senior" | "Staff"; differs: boolean };
```

它必须标记为非权威、不得进入 candidate-facing report、不得影响 overall recommendation。经过一个发布周期并确认没有消费者依赖后删除 `applySystemDesignLevelCap` 路径及 shadow 字段。

### 4.3 Recommendation 边界

`generateSessionReport` 目前另有 coding-oriented `recommendation`。本改动不得把 system-design 的 unified verdict 静默覆盖该字段。

- 系统设计页面只以 `systemDesignDna.adjudication` 展示系统设计结论。
- 若未来要让 unified verdict 驱动全局 `recommendation`，必须建立独立映射 spec，明确 coding/system-design 的 mode gate、历史报告兼容性与校准数据；不属于本次范围。

## 5. 失败语义

| 场景 | observed status | shadow 候选人输出 | enforced 候选人输出 | Admin/replay |
|---|---|---|---|---|
| 完整、低分、cap 触发 | FINAL | capped verdict + blockers | 同 shadow | 完整 breakdown |
| 完整、高分、无 cap | FINAL | capped verdict | 同 shadow | 完整 breakdown |
| partial/STT/interrupted | DEGRADED_INPUT | scored verdict + shadow 警示 | 不给最终 verdict | score + degradation reasons |
| snapshot/assessment 不可用 | DEGRADED_INPUT | scored verdict + shadow 警示 | 不给最终 verdict | health diagnostics |
| 只有 1–2 个明确 signal | INSUFFICIENT_EVIDENCE | scored verdict + shadow 警示 | 不给最终 verdict | score + coverage reasons |
| 无 candidate transcript | INSUFFICIENT_EVIDENCE | scored verdict + shadow 警示 | 不给最终 verdict | score 不作为评价展示 |
| 关键三维只有推断文字 | INSUFFICIENT_EVIDENCE | scored verdict + shadow 警示 | 不给最终 verdict | evidence parsing diagnostics |

## 6. 校准与版本治理

[`system-design-real-calibration.ts`](../../src/lib/evaluation/system-design-real-calibration.ts) 的现有 level/verdict accuracy 与 confusion matrix 保留，但须扩展为：

- `status` 分布与拒判率（coverage）；
- 仅对 `FINAL` 样本计算 level/verdict accuracy；
- 按 confidence bucket（0–0.2 … 0.8–1.0）计算 accuracy、平均 confidence、Brier score 与 ECE；
- 按 `appliedCaps`、noise、coverage bucket、target level 输出 confusion；
- 特别报告 false-Hire rate：`expected NO_HIRE/BORDERLINE` 却给出 `FINAL HIRE/STRONG_HIRE` 的比例。

数据集的每条 label 新增可选的 `expectedDecisionability`，先允许缺失以兼容旧 JSONL；新标注样本必须填写。评估输出包含 dataset version、scoring version 与 adjudication schema version。

### 6.1 Enforced 启用 review gate

shadow dry-run 后必须产出一份可 review 的 calibration artifact，至少包含：

- 总样本数及按题目、target level、session 长度的分布；
- `FINAL` coverage 和总拒判率，以及 `INSUFFICIENT_EVIDENCE`/`DEGRADED_INPUT` 各自比例；
- 按 provisional 规则逐条列出的命中率，尤其是 `<3 signals`、`<3 refs` 与“关键三维至少一个 direct evidence”；
- evidence `linkSuccessRate` 与失败原因；
- FINAL 子集 accuracy、false-Hire rate、ECE/Brier；
- 被拒判样本原本的 expected/predicted confusion，避免通过大量拒判虚增 accuracy。

退出 review 时必须由 reviewer 明确记录 `APPROVE_ENFORCEMENT` 或 `KEEP_SHADOW`。不存在仅凭测试全绿、总体 accuracy 提升或“已记录 coverage”自动启用 enforced 的路径。若 coverage 明显偏低/偏高、样本量不足或 link success 不稳定，保持 shadow，并调整数据链或另立阈值变更 spec。

阈值、status 规则或等级映射任一改变，必须：更新此 spec 的版本、在标注集上重跑评估、记录变化前后上述指标，并增加一条代表性 regression fixture。没有足够标注样本时，保持阈值不变。

## 7. 测试矩阵

| 类别 | 例子 | 必须断言 |
|---|---|---|
| 单一权威 | legacy 为 Staff、unified cap 为 L4 | 只以 L4 映射候选人结论；shadow 仅 Admin |
| cap 非补偿 | 强 pivot + capacity < 3.2 | `FINAL`、`cappedLevel <= L4` |
| confidence 独立 | 相同 caps、不同 rescue/noise | capped level 不变；confidence/status 按规则变化 |
| 证据不足 | 两个 signal、或无 direct evidence | observed status 为 `INSUFFICIENT_EVIDENCE`；仅 enforced 的 candidate verdict 为 null |
| 输入退化 | partial/STT/interrupted 或 unhealthy bundle | observed status 为 `DEGRADED_INPUT`；仅 enforced 的 candidate verdict 为 null；无 pivot lift |
| 优先级 | partial 且只有一个 signal | `DEGRADED_INPUT` 且 reasons 包含两类问题 |
| evidence link | ordinal/snippet 可解析但无稳定 transcript ID | 不计 direct evidence；记录 link failure |
| assessment 版本 | 同 turn v1/v2、或 transcript correction | 只使用最高版本；correction 绑定新 committed USER id |
| shadow 安全 | provisional status 非 FINAL | candidate verdict 仍为 scored verdict，并带 shadow 标记 |
| reward 非因果 | 正负/有无 reward trace | adjudication 完全一致 |
| 决定性 | event/evidence 排列变化 | 完全相同的 adjudication |
| 边界 | 3.2、3.6、4.4 等阈值前后 | cap 与 raw level 边界符合既有契约 |
| UI/API | null level/verdict 的 report JSON | 清晰 unavailable 文案；不渲染 legacy/raw 为最终建议 |
| 校准 | fixture 的 final/non-final 混合 | 分层指标、拒判率、false-Hire 正确 |

测试位置：

- `src/lib/scoring/adjudicate-score.test.ts`（新）
- `src/lib/scoring/calculateUnifiedScore.test.ts`（保留低层性质测试）
- `src/lib/evaluation/report.test.ts`
- `src/lib/evaluation/system-design-real-calibration.test.ts`
- report API/page、Admin 的组件或 route tests

## 8. 实施顺序与退出标准

1. Phase A：增加单一 adjudication 输出并接入 `buildSystemDesignDna`；`cappedLevel` 映射为唯一候选人等级，legacy 仅保留 Admin shadow 或在确认无消费者时直接删除。此步不启用拒判。
2. Phase A：更新 report/API/Admin UI 与测试，证明不存在 legacy/raw level 作为第二个最终结论。
3. Phase B 前置：实现 §3.2 canonical evidence link 与验证工具，先报告 link success/failure，不改变候选人输出。
4. Phase B shadow：增加 provisional sufficiency evaluator、types 与单元测试，固定 `decisionabilityMode="shadow"`。
5. 扩展 real-calibration 工具和 fixture，生成 §6.1 artifact；对 coverage、拒判构成和 evidence link 做人工 review，不调整阈值。
6. 只有获得 `APPROVE_ENFORCEMENT` 后，才能提交显式版本变更启用 enforced；否则保持 shadow。
7. 无外部消费者时可在 Phase A 直接删除 legacy；若选择兼容窗口，则经一个发布周期确认 shadow diff 与 consumer 使用后删除。

完成条件：

- Phase A 完成即要求：候选人可见的系统设计最终结论只有一个权威来源，双权威 bug 已关闭。
- Phase B shadow 完成必须生成并人工 review coverage/link artifact；仅“记录指标”不算通过启用门。
- 只有 enforced 获批后才要求：所有非 FINAL 输出都没有 candidate-facing verdict，且可解释其缺失原因。
- reward 无法通过任何公开评分路径影响 adjudication。
- 新增矩阵覆盖，且全量 unit、`npx tsc --noEmit`、`npm run build`、system-design calibration/gates 通过。
- 实施完成后更新 `docs/specs/repository-remediation-spec.md` 的执行记录，列出 schema 版本、兼容窗口、校准指标与遗留项。

## 9. 执行记录

### Phase A：完成（2026-09-11）

- 新增 `src/lib/scoring/adjudicate-score.ts` 与 `ScoreAdjudication` 类型；纯 adjudicator 只调用一次 unified scorer，并以 `cappedLevel` 映射 `reportLevel` 和候选人 verdict。
- Phase A 固定 `decisionabilityMode="shadow"`、`status="FINAL"`；未实现、未启用 provisional 充分性阈值或拒判行为。
- `buildSystemDesignDna` 的 `levelRecommendation`、raw/capped level、verdict、confidence 和 caps 全部来自 adjudication/unified result。
- legacy `applySystemDesignLevelCap` 仅输出 `adminOnlyLegacyShadow`，带 `audience="admin_only"`、`causalRole="none"` 和差异标记；其 notes 不再混入候选人 calibration notes。
- report page 优先从 adjudication 读取推荐等级、capped level 和 candidate-facing verdict；旧字段只作为历史 v0 报告兼容 fallback。
- report route 将新生成报告版本提升为 `v1`。
- 验证：新增 adjudicator 3 个测试；scoring/report/report-route 针对性 23 个测试通过；全量 71 files / 433 tests 通过；`npx tsc --noEmit` 与 `npm run build` 通过；`git diff --check` 通过。
- Phase B 的 evidence-link、shadow coverage artifact、人工 enforcement review 尚未开始。
