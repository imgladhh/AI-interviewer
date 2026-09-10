# AI Interviewer 代码库整改规范

状态：`BASELINE v1.2`
制定日期：2026-09-09
适用仓库：AI Interviewer
当前定位：本地运行、面试演示、简历项目；不提供公网可访问的 demo

## 1. 目的与执行约束

本文件是 2026-09-09 全库审计后的整改基线。后续修改必须按本文件规定的批次、范围和验收标准执行。

执行规则：

1. 先完成当前批次的强制验收，再进入下一批；标记为“非阻塞”的项目除外。
2. 不得用降低断言、跳过测试或隐藏错误日志的方式制造“全绿”。
3. 一个修复若改变本文件定义的接口、数据权威、优先级或验收标准，必须先更新本文件，再修改代码。
4. 每批应保持独立、可审查；依赖升级与业务修复分开提交。
5. 保留用户现有的未跟踪文件和无关改动，不把它们纳入整改提交。
6. 当前“不公开部署”的假设一旦改变，必须先执行第六批公网准入，不得直接暴露服务。
7. 第二批和第三批各自在开工前必须先建立一份实现级子 spec，经 review 后才能修改业务代码。子 spec 至少要固定数据类型、权威来源、状态转换、失败语义、数据库约束和测试矩阵。

## 2. 风险口径

本规范同时保留两套优先级，二者不能混用：

- 安全严重性：假设服务暴露在公网且存在不受信任调用者，衡量最坏影响。
- 整改顺序：按当前本地简历项目定位，优先消除面试官可直接观察到的失败、语义断裂和一致性缺陷。

因此，主机代码执行、SSRF 和依赖漏洞仍是高严重性问题，但完整的公网级隔离、认证和滥用防护不会抢占“仓库全绿 → 语义闭环 → 状态一致性”的主线。当前允许延后完整硬化的前提是：开发服务仅绑定本机、不做端口映射、不接受来源不明的代码或 URL、三个安全开关默认关闭。

## 3. 审计基线

审计时观察到的基线：

- TypeScript 类型检查通过。
- Next.js 生产构建完成，但构建期间 Redis/BullMQ 在模块导入阶段尝试连接，产生大量连接错误。
- 单元测试为 380/381，通过 380 个；失败用例暴露出题库与编辑器模板契约不完整。
- 题库有 103 个唯一 coding 标题：`BASE_QUESTION_BANK` 有 31 个 coding 标题；`fromSeed` 批量生成 72 个种子/扩展标题，其中 `Maximum Subarray` 被提升为 curated。因此 `CURATED_CODING_TITLES` 有 32 个标题，仍允许通用 starter 的纯种子集合为 71 个标题。
- `Maximum Subarray` 是被提升为精选体验要求的 coding 题，缺少专用 starter；`Design Dropbox` 是 system-design 题，不参与 coding starter 覆盖检查。
- system-design gates 与 alert checker 当时通过，但最新监控产物停留在 2026-04-18，现有检查不验证 freshness。
- `npm audit --omit=dev` 当时报告 17 个生产依赖漏洞：1 critical、9 high、7 moderate；锁定的 Next.js 版本为 15.5.14。
- 审计未修改仓库文件。

测试数量会随新增回归用例增加。后续“381/381”表示第一批必须至少恢复原有 381 个用例全部通过；新增测试也必须全部通过。

## 4. 问题清单与目标修复

### #1 主机代码执行与不安全降级

- 安全严重性：Critical（公网）；本地整改优先级：第四批。
- 代码位置：`src/app/api/sessions/[id]/code-runs/route.ts`、`src/lib/sandbox/execute.ts`。
- 现状：code-run API 可触发用户代码执行；Docker 未启用或失败时会降级到宿主机进程，子进程继承服务端环境变量。
- 修复：增加 `ENABLE_CODE_RUNS`，默认关闭整个执行端点；增加 `ENABLE_HOST_CODE_EXECUTION`，默认关闭宿主机执行。启用 code-run 时优先使用 Docker，Docker 不可用必须 fail closed，只有本地操作者再次显式开启 host flag 才允许降级。宿主进程使用最小环境白名单，不继承应用 secrets。
- 验收：默认请求返回明确的禁用状态且不创建 snapshot/event、不启动进程；Docker 失败不会触发宿主执行；host 模式需要两个显式开关并有单测。

### #2 Persona URL 可触发 SSRF

- 安全严重性：Critical（公网）；本地整改优先级：第四批。
- 代码位置：`src/app/api/interviewer-profiles/**`、`src/lib/persona/normalize-url.ts`、`src/lib/persona/ingest-public-profile.ts`。
- 现状：服务端直接抓取用户提供的 URL，缺少对 loopback、私网、link-local、云 metadata 地址、DNS 重绑定及重定向目标的完整限制，也缺少严格响应上限和超时。
- 修复：增加 `ENABLE_PERSONA_INGESTION`，默认关闭 persona preview/create/fetch 能力并 fail closed。若未来启用公网抓取，再实现协议白名单、每跳 DNS/IP 校验、禁止私网/本机/metadata、受控重定向、连接/读取超时、内容类型与响应体大小限制。
- 验收：默认端点不入队、不写 profile、不发网络请求；本地显式开启的行为有测试；公网启用前必须通过私网、IPv6、重定向和 DNS 重绑定测试集。

### #3 Next.js 生产依赖存在已知漏洞

- 安全严重性：Critical；本地整改优先级：第一批末尾，非阻塞。
- 代码位置：`package.json`、`package-lock.json`、Next.js middleware/build 边界。
- 现状：审计时解析到 Next.js 15.5.14，`npm audit --omit=dev` 报告 critical advisory。
- 修复：单独升级到同一主版本中已修复的最新稳定版本；依赖升级不得夹带业务修改。升级后检查 middleware、缓存语义、route handler 类型和构建行为。
- 验收：全量单测、类型检查、生产构建通过；重新执行 `npm audit --omit=dev` 并记录剩余 production advisories。若升级引发跨版本兼容性兔子洞，记录原因并延期，不阻塞 #12、#13、#15 达成第一批全绿。

### #4 缺少真实认证、授权与资源归属检查

- 安全严重性：High（公网）；本地整改优先级：第六批公网准入。
- 代码位置：`src/app/api/sessions/**`、`src/app/api/interviewer-profiles/**`、admin routes、demo user 创建路径。
- 现状：系统以固定 demo user 为中心，知道资源 ID 的调用者可读取或修改 session/profile；可选 admin token 不能替代用户认证和对象级授权。
- 修复：当前保持 local-only 并在 README 明示限制。若决定公开部署，引入真实 session identity，为所有读写路由统一执行 ownership/role policy；资源查询必须携带 owner 条件，admin 使用独立角色。
- 验收：未登录、跨用户资源 ID、普通用户访问 admin 均被拒绝；不存在仅先查询 ID、后遗漏 owner 条件的路径；覆盖 route integration tests。

### #5 客户端可以写入服务端权威事件和 AI transcript

- 安全严重性：High；本地整改优先级：第三批。
- 代码位置：`src/app/api/sessions/[id]/events/route.ts`、`src/app/api/sessions/[id]/transcripts/route.ts` 及调用方。
- 现状：通用写接口允许客户端提交过宽的 event type / speaker / payload，因而可能伪造系统决策、评分依据或 AI 发言。持久化审计事实与客户端输入边界不清晰。
- 修复：定义 server-owned 与 client-accepted 类型白名单。客户端只允许提交候选人输入及明确的 UI telemetry；AI/SYSTEM transcript、决策、评分、生命周期事件只能由服务端内部命令写入。将内部写入从公共 route schema 中分离。
- 验收：伪造 AI/SYSTEM transcript 或权威 event 返回 4xx 且无数据库副作用；合法 USER transcript 保持可用；报告与 admin 只消费服务端权威事件。

### #6 多步写入缺少事务、幂等与唯一序列约束

- 安全严重性：High；本地整改优先级：第三批。
- 代码位置：session 创建、transcript、code-run、assistant-turn/stream、report、snapshot 写入路径，assistant-turn 的前端发起方（当前为 `src/components/interview/interview-room-client.tsx`），以及 `prisma/schema.prisma`。
- 现状：多个 route 先读最大 `segmentIndex`/`snapshotIndex` 再加一，并分步写 transcript、event、reward、snapshot 和 session stage。并发、重试、中断可造成重复索引、部分持久化或用户可见回复与审计状态分叉。
- 修复：为一个逻辑动作定义 transaction boundary；由 assistant-turn 的客户端发起方生成稳定的 `turnId`/idempotency key，并在网络重试时复用同一个值，服务端以该 key 去重；对 `(sessionId, segmentIndex)` 与 `(sessionId, snapshotIndex)` 增加 unique 约束；通过事务内原子分配或冲突重试生成序列。流式路径明确“发送不可回滚、落库可恢复”的 outbox/turn-commit 契约。
- migration 前置：先查询本地开发库重复索引；若存在，备份后确定性去重或清空 dev 数据，再添加约束。还必须确认 transcript 更正语义：当前 `correctionOfId` 通过事件关联旧片段，而更正记录分配新的 `segmentIndex`；实现唯一约束时必须保留“新版本用新 index”的契约，禁止复用被更正片段的 index。不得把存量重复导致的 migration 失败误判为 schema 写错。
- 验收：并发请求和重复请求只产生一个逻辑结果；故障注入不会留下不可解释的半成品；唯一约束生效；stream abort/retry 有集成测试。

### #7 外部输入、输出、成本与滥用控制不足

- 安全严重性：High（公网）；本地整改优先级：第五批基础限额，第六批公网加固。
- 代码位置：STT、assistant provider、persona、code-run、transcript/event 路由及 `src/lib/security/request-guard.ts`。
- 现状：已有可选 mutation guard，但缺少覆盖所有昂贵路径的分布式限流，以及一致的 body/code/stdin/audio/transcript/provider-output 上限、超时和成本预算。
- 修复：先添加确定性的请求大小、文本长度、输出截断、provider timeout 和每次会话预算；公网部署时使用 Redis-backed、按 identity/IP/route 分类的分布式 rate limit，并记录拒绝原因与成本指标。
- 验收：超限请求在昂贵操作前失败；输出有界；多实例限流测试通过；日志不泄露 payload/secrets。

### #8 监控没有 availability/freshness/schema 语义

- 安全严重性：Medium；本地整改优先级：第二批。
- 代码位置：`src/lib/operations/system-design-monitoring.ts`、`src/scripts/check-system-design-alerts.ts`、`src/scripts/eval-system-design-weekly.ts`、`.github/workflows/system-design-monitoring.yml`、admin UI。
- 现状：缺失字段和缺失 dated drift snapshot 会被默认为 0；不可读产物与真实质量告警共享失败语义；旧的 `latest.json` 仍可能显示为健康。当前产物已明显过期。
- 修复：引入版本化监控 envelope，显式区分 `available`、`valid`、`fresh`、`qualityStatus`；以 `generatedAt` 和可配置最大年龄判断 stale；原子发布 latest；CLI 为 telemetry failure 与 quality regression 输出不同、可操作的结果；admin 显示缺失/无效/过期而非隐藏或归零。
- 验收：fresh healthy、fresh regression、stale、missing、malformed、partial/old-schema fixtures 全覆盖；CI/cron exit contract 文档化；过期产物不能显示为 green。

### #9 Snapshot 失败会静默并进程级永久降级

- 安全严重性：Medium；本地整改优先级：第二批末尾。
- 代码位置：`src/lib/session/snapshots.ts`、assistant-turn routes、admin snapshot assembly。
- 现状：缺表错误会设置进程级 `snapshotPersistenceDisabled`，后续读返回空数组；其他写失败也主要是日志降级。四类 snapshot 使用并行非事务写，admin 只有部分 event fallback，可能把观测缺失误认为空状态。
- 修复：event log 作为权威事实；snapshot 明确标记健康状态和降级原因；区分 missing-schema、transient、partial failure；支持重试/重建，不使用不可恢复的进程级永久关闭；必要时用 outbox 从事件重放 projection。
- 验收：缺表、暂时 DB 故障、四写一失败、恢复和进程重启均有故障注入测试；admin 明确展示 degraded，且可从权威事件恢复。

### #10 信号观察、证据记账与对话健康缺少统一权威

- 安全严重性：Medium；本地整改优先级：第三批后半。
- 代码位置：`src/lib/assistant/signal_extractor.ts`、`memory_ledger.ts`、`conversation_health.ts`、`generate-turn.ts` 及 assistant-turn routes。
- 现状：provider observation 可逐字段覆盖 heuristic snapshot；持久化记录不足以重放观察来源和 transcript evidence span；ledger 可直接根据信号状态授予 evidence；echo 可能同时通过 snapshot、echo event 和相邻文本指标多次影响健康度。
- 修复：建立按 candidate turn 标识的版本化 assessment，保存 heuristic/provider 原始观察、来源、置信度、证据 span 和 adjudicated result；ledger 与 health 只消费同一份裁决结果；append-only supersession，唯一键建议为 `(sessionId, candidateTurnId, assessmentVersion)`。
- 验收：provider/heuristic 冲突、无效 JSON、fallback、重放、重复事件、真实复述与错误回声均有确定性 fixtures；相同事件流产生相同 ledger/health。

### #11 `rewardTrace` 是非因果的死输入

- 安全严重性：Low；本地整改优先级：第二批。
- 代码位置：`src/lib/scoring/calculateUnifiedScore.ts`、`src/lib/assistant/reward.ts`、报告生成路径。
- 现状：统一评分准备并过滤 reward trace，但 dimension aggregation 和最终 recommendation 不读取它；接口看似参与评分，实际仅具审计作用，容易制造错误心智模型。
- 修复：本轮明确选择“reward 是 interviewer-policy telemetry，不是候选人能力证据”。从评分输入契约中移除其因果暗示，在报告中以独立、带 provenance 的 telemetry 展示。只有未来建立版本化、避免与 signal 重复计分且完成校准的数据模型后，才能让 reward 影响分数。
- 验收：类型和命名体现非因果关系；改变 reward 不会改变 score 的性质测试被显式保留；报告能解释 reward 用途；不存在过滤后未使用的假数据流。

### #12 Starter 覆盖测试失败且模板缺失

- 安全严重性：Low；本地整改优先级：第一批第 1 项，阻塞。
- 代码位置：`src/lib/interview/editor.ts`、`src/lib/interview/editor.test.ts`、`src/lib/interview/question-bank.ts`。
- 现状：两个问题叠加：测试错误地把 system-design 的 `Design Dropbox` 纳入 coding starter 覆盖；同时它把 `fromSeed` 批量生成的种子题与精选题混为一层，要求全部拥有手写签名模板。`Maximum Subarray` 虽来自种子层，但被明确提升为需要专用体验的标题，原先确实落入通用 `solve(input)`。
- 两层契约：
  1. Base 层有 31 个 coding 标题；精选层必须有专用模板：导出稳定、显式的 `CURATED_CODING_TITLES`，它由这 31 个 BASE coding 标题与被显式提升的 `Maximum Subarray` 组成；该集合当前为 32 个标题。测试必须对该集合断言不会退回通用 `solve(input)`。
  2. 种子/扩展层允许通用 starter：除被提升的 `Maximum Subarray` 外，其余 71 个 `fromSeed` 标题不要求猜测参数或返回类型。测试必须对全部 coding 标题断言 starter 非空、包含明确 TODO；对纯种子集合还须断言 starter 包含题目标题。现有 `solve(input)` 骨架满足该契约。
- 修复：在 `TEMPLATES` 添加 `Maximum Subarray`，Python 函数 `max_subarray(nums) -> int`，JavaScript 函数 `maxSubArray(nums)`，并补针对性断言；导出上述 curated 集合；把覆盖测试拆为“精选层专用模板”与“全 coding 题通用骨架可用”两项。
- 验收：不能仅删除断言；必须显式建立两层集合及各自断言。32 个精选标题均有专用模板，全部 103 个 coding 标题均有非空、含 TODO 的 starter，71 个纯种子标题的 starter 还必须含题目标题；原 381 个测试与新增测试全部通过。

### #13 `difficulty` 是死输入且空题池仍创建 READY session

- 安全严重性：Low；本地整改优先级：第一批第 2 项，阻塞。
- 代码位置：`src/schemas/session.ts`、`src/app/api/sessions/route.ts`、setup UI。
- 现状：API 接受 difficulty，但选题查询不使用；找不到匹配题时仍可创建 `READY` 且 `questionId = null` 的 session。
- 已验证前提：当前 setup UI 不展示 difficulty，也不向 session API 发送该字段；当前种子题库覆盖 CODING 的 EASY/MEDIUM/HARD，但 SYSTEM_DESIGN 只有 MEDIUM。
- 修复：将 difficulty 纳入非显式 questionId 的题库过滤，并且对 CODING 和 SYSTEM_DESIGN 两种 mode 都生效。`levelTarget` 必须维持 CODING-only：只有 `mode === "CODING"` 时按 target level 过滤，禁止把 level 条件加到 SYSTEM_DESIGN 查询。company-specific → generic fallback 必须保持相同的 mode/difficulty，且只在 CODING 下同时保持相同 level。若没有匹配题，在任何 session/event/context 写入前返回 409。显式 questionId 继续以该题为准，但需校验 active 和 mode 兼容性。
- UI 契约：不得向用户提供题库无法满足的 mode/difficulty 组合。若第一批新增或暴露 difficulty 选择器，必须由题库能力驱动选项；以当前题库为准，SYSTEM_DESIGN 只能启用 MEDIUM，除非先补齐其他难度种子题。若保持当前 UI 不暴露 difficulty，则必须验证不传该字段的默认选题路径继续可用。
- 验收：两种 mode 的 difficulty 查询断言、CODING-only level 断言、company fallback、显式题、空题池无副作用测试通过；测试覆盖 UI/API 所有可选组合，或证明无题组合在 UI 被禁用；任何 READY session 都必须有合法 questionId。

### #14 CI 没有覆盖仓库级完整质量门

- 安全严重性：Low；本地整改优先级：第五批。
- 代码位置：`.github/workflows/system-design-gates.yml`、Playwright 配置、package scripts。
- 现状：PR workflow 只运行 system-design 子集和专项 gate，没有把全量 unit、类型检查、production build、关键 route integration/E2E 和 production dependency audit 组成统一准入门。
- 修复：增加 repository quality workflow，依次执行 clean install、Prisma generate、全量 unit、`tsc --noEmit`、build、核心无外部依赖的 smoke/E2E；`npm audit --omit=dev` 使用明确的 severity policy，避免 dev-only advisory 阻塞运行时口径。需要 Postgres/Redis 的任务使用声明式 services 和健康检查。
- 验收：一个故意失败的 unit/type/build 会阻塞 PR；workflow 不依赖开发者本地数据；README 与 CI 命令一致。

### #15 Redis/BullMQ 在模块导入时建立连接

- 安全严重性：Low；本地整改优先级：第一批第 3 项，阻塞。
- 代码位置：`src/lib/redis.ts`、`src/lib/persona/queue.ts`、`src/lib/health.ts`、`src/workers/persona-worker.ts`。
- 现状：导入模块即 new `IORedis`、`Queue` 和 `QueueEvents`，导致 build/test 在未使用队列时也尝试连接 Redis 并刷屏报错。
- 修复：改为 memoized getter；只有 health request、persona queue 操作或 worker 启动时才创建连接。worker 显式取得并负责关闭自己的 queue events/Redis；普通模块导入无 I/O。
- 验收：Redis 未启动时，单纯 import、全量 unit 和 production build 不产生连接错误或悬挂句柄；实际 health/queue 调用仍能连接并正确报告失败。

## 5. 强制整改顺序

### 第一批：仓库全绿

按以下顺序执行：

1. #12：同时修正 coding-only 测试契约并补 `Maximum Subarray` 专用模板。
2. #13：让 difficulty 生效，空题池 fail closed 且零副作用。
3. #15：Redis、Queue、QueueEvents 惰性初始化。
4. #3：Next.js 安全升级，独立变更、非阻塞。

批次门槛：前三项完成后，全量 unit（至少原 381 项）、类型检查和 production build 必须全部通过，build 在 Redis 未运行时无连接错误。#3 若延期，必须在整改记录中保留 audit 输出和原因。

### 第二批：语义与可观测性闭环

开工门槛：先提交第二批实现级子 spec，明确 reward telemetry schema、监控 envelope/exit code、snapshot health/rebuild 契约及故障测试矩阵，经 review 后执行。

1. #11：明确 reward telemetry 的非因果契约。
2. #8：监控 availability/freshness/schema/quality 四态契约。
3. #9：snapshot 降级可见、可恢复，event log 成为权威。

批次门槛：评分输入无伪因果；过期/缺失数据不显示为健康；snapshot 故障不再静默伪装为空状态。

### 第三批：状态一致性与证据权威

开工门槛：先提交第三批实现级子 spec，明确客户端命令白名单、server-owned event 类型、`turnId` 生命周期、事务边界、表结构/唯一键、stream commit 状态机、assessment schema 和迁移步骤，经 review 后执行。

1. #5：收紧客户端/服务端事件与 transcript 边界。
2. #6：事务、幂等、唯一序列约束和流式 commit 契约。
3. #10：turn-keyed、可重放的 evidence assessment。

批次门槛：客户端不能伪造权威事实；并发/重试不会复制逻辑写入；报告、ledger、health 能从同一权威事件流确定性重建。

### 第四批：本地项目的 fail-closed 安全姿态

1. #1：`ENABLE_CODE_RUNS=false`、`ENABLE_HOST_CODE_EXECUTION=false`。
2. #2：`ENABLE_PERSONA_INGESTION=false`。
3. 更新 `.env.example` 和 README，写清三个开关、默认关闭及 local-only 成立条件。

批次门槛：默认配置不会执行代码或抓取 URL；README 明确声明这不是可直接公网部署的安全边界。

### 第五批：仓库级工程门槛

1. #7：先实施不依赖身份系统的请求/输出/超时/成本上限。
2. #14：建立全量 CI 和稳定的核心 smoke/E2E。

批次门槛：常见资源滥用在昂贵操作前被拒绝；PR 对 unit/type/build 回归 fail closed。

### 第六批：仅在决定公开部署时执行

1. #4：真实认证、对象级授权、admin role。
2. #2：完整 SSRF 防护，而不只是 feature gate。
3. #1：只允许经过验证的隔离执行环境，彻底禁止 host fallback。
4. #7：分布式限流、配额、成本和审计。
5. 威胁建模、secrets rotation、部署拓扑检查、外部渗透测试。

公网准入门槛：第六批未完成时，不得绑定公网地址、做端口映射或发布公开 demo 链接。

## 6. 每批通用验收与证据

每批结束必须记录：

- 改动文件与对应问题编号。
- 新增/修改的测试及其验证场景。
- `npm test` 结果。
- `npx tsc --noEmit` 结果。
- `npm run build` 结果。
- 涉及依赖时的 `npm audit --omit=dev` 结果。
- 涉及 migration 时的重复数据预检、处理方式和 migration 结果。
- 已知未解决项、延期原因以及是否改变下一批前置条件。

任何命令“通过但伴随未解释的错误日志”都不算验收通过。

## 7. 明确不在当前范围内的事项

- 当前不实现面向公网的完整多用户认证系统。
- 当前不把本地代码执行包装成“安全沙箱”；feature gate 只是降低误暴露风险。
- 当前不让 reward 直接影响候选人最终分数。
- 当前不在没有标注数据和校准实验的情况下调整 echo 或 scoring 阈值。
- 当前不以清空用户数据作为默认 migration 策略；仅可对确认属于可重建的本地开发数据这么做。
- 当前不因为依赖升级扩大为 Next.js 主版本迁移。

## 8. 变更记录

- 2026-09-09：建立 `BASELINE v1`。纳入全库审计的 15 项问题，并按本地简历项目定位重排为六批；修正 #12 为“测试契约 + `Maximum Subarray` 模板”双修复；补充 Next.js 非阻塞策略和唯一约束 migration 的存量重复数据前置检查。
- 2026-09-09：更新为 `BASELINE v1.1`。明确 #13 的 difficulty 双 mode、level CODING-only 契约及 UI/种子题组合覆盖；为 #6 增加客户端稳定 `turnId` 和 transcript 更正使用新 index 的约束；规定第二、三批开工前必须先 review 实现级子 spec；统一“本地整改优先级”措辞。
- 2026-09-09：更新为 `BASELINE v1.2`。更正 #12 基线统计：v1.1 遗漏了 `fromSeed` 批量生成的种子题。定义 BASE coding 层为 31 个标题、`CURATED_CODING_TITLES` 为 32 个标题（BASE 加被提升的 `Maximum Subarray`）、纯种子层为 71 个标题；分别建立专用 starter 与题目感知通用 starter 的契约，而非用 73 个猜测签名的假模板换取全绿。

## 9. 执行记录

### 第一批：完成（2026-09-09）

- #12：添加 `Maximum Subarray` 专用模板；导出 32 项 `CURATED_CODING_TITLES`；分别验证 curated 专用 starter 与 71 个纯种子标题的题目感知 TODO 骨架。
- #13：difficulty 对 CODING 与 SYSTEM_DESIGN 都参与选题；level 仍严格仅作用于 CODING；不匹配题池或 mode 不兼容的显式题在写入任何 session/event 前返回 409。补充 company fallback、空池和显式题的回归测试。
- #15：Redis、BullMQ Queue 和 QueueEvents 改为 memoized getter；普通模块导入不建立连接，health 和 worker 在实际使用时显式取得客户端。补充导入无 I/O 与 singleton 行为测试。
- #3：独立升级 Next.js 15.5.14 → 15.5.25。`npm audit --omit=dev` 从 1 critical、9 high、7 moderate 变为 0 critical、9 high、8 moderate。Next.js 剩余项为经 PostCSS 的 moderate；npm 给出的修复为 Next.js 16.3.4（主版本迁移），按第一批非阻塞规则延期。
- 验证：`npm test` 60 files / 388 tests 全部通过；`npx tsc --noEmit` 通过；`npm run build` 通过，且不再出现 Redis 导入时的连接错误。
