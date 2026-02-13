# PAI 架构增强方案
## 基于 oh-my-opencode 优秀设计的吸收计划

**分析日期**: 2026-02-13
**分析人**: 千千
**目标**: 增强 PAI v2.5 的架构和能力

---

## 📊 一、架构对比分析

### 1.1 核心架构差异

| 维度 | PAI v2.5 | oh-my-opencode v3.5 |
|------|-----------|---------------------|
| **哲学** | 持续学习，懂你的系统 | 多模型协调，执行效率 |
| **Hook 系统** | 14 个 Hooks（手工注册） | 41 个 Hooks（3层架构） |
| **配置管理** | SKILL.md (YAML frontmatter) | JSONC + Zod Schema (21个组件) |
| **代理管理** | 动态组合 (Traits) | 11 个专用 Agents |
| **任务系统** | The Algorithm (ISC) | Background Manager (1646行) |
| **并发控制** | 无 | ConcurrencyManager (per provider/model) |
| **错误恢复** | Ralph Loop | Session Recovery (1279行) |
| **测试覆盖** | 基础验证 | 176 个测试文件 (TDD) |
| **类型安全** | 部分 | 完整 (zod + TypeScript) |

### 1.2 Hook 系统架构对比

#### **PAI Hook 系统（简单型）**
```typescript
// PAI: 直接注册 hooks
const hooks: Record<string, Hook> = {
  'session.start': startupGreeting,
  'user.prompt': formatEnforcer,
  'tool.execute': securityValidator,
  // ... 14 个 hooks
}
```

#### **oh-my-opencode Hook 系统（分层型）**
```typescript
// oh-my-opencode: 3 层架构
createHooks()
├── createCoreHooks()          // 20 个核心 hooks
│   ├── createSessionHooks()    // 会话管理
│   ├── createToolGuardHooks()  // 工具守护
│   └── createTransformHooks() // 消息转换
├── createContinuationHooks()   // 7 个延续 hooks
│   ├── todoContinuationEnforcer
│   ├── compactionTodoPreserver
│   └── atlas
└── createSkillHooks()          // 2 个技能 hooks
```

**关键差异**:
- **PAI**: 扁平结构，难以扩展
- **oh-my-opencode**: 分层架构，职责清晰，可组合

### 1.3 配置系统对比

#### **PAI 配置（弱类型）**
```yaml
# SKILL.md frontmatter
name: Research
description: "..."
model: claude-opus-4-6  # 字符串，无验证
agent: librarian
```

**问题**:
- ❌ 无运行时验证
- ❌ 无类型提示
- ❌ 无自动补全
- ❌ JSONC 注释支持有限

#### **oh-my-opencode 配置（强类型）**
```typescript
// 21 个 Zod schema 组件
import { z } from "zod"

const OhMyOpenCodeConfigSchema = z.object({
  agents: z.record(z.object({
    model: z.string().optional(),
    variant: z.string().optional(),
    temperature: z.number().min(0).max(1).optional()
  })),
  background_task: z.object({
    enabled: z.boolean(),
    max_parallel: z.number().min(1).default(3)
  }).optional()
  // ... 19+ 更多配置项
})

// 自动生成 JSON Schema
// JSONC 支持（注释、尾随逗号）
// IDE 自动补全
```

**优势**:
- ✅ 类型安全
- ✅ 运行时验证
- ✅ 错误提示清晰
- ✅ 自动生成文档

---

## 🏆 二、oh-my-opencode 优秀设计

### 2.1 Background Agent Manager（优先级：P0）

**代码位置**: `src/features/background-agent/manager.ts` (1646 lines)

**核心特性**:
```typescript
export class BackgroundManager {
  // 并发控制 - 按 provider/model 分组
  private concurrencyManager: ConcurrencyManager

  // 任务队列管理
  private queuesByKey: Map<string, QueueItem[]>
  private processingKeys: Set<string>

  // 生命周期管理
  async launch(input: LaunchInput): Promise<BackgroundTask>
  private poll(): void  // 持续轮询状态
  private cleanup(): void  // 自动清理过期任务

  // 智能调度
  private shouldProcessItem(item: QueueItem): boolean
  private batchNotify(parentID: string): Promise<void>
}
```

**关键设计模式**:

1. **并发控制**
```typescript
// 按 provider/model 分组限制并发
const limits = {
  'anthropic': { total: 5, opus: 2, sonnet: 3 },
  'openai': { total: 10, gpt5: 5, gpt4: 5 }
}

// 防止超限和成本爆炸
if (!concurrencyManager.canLaunch(provider, model)) {
  await queue(task)  // 排队等待
}
```

2. **任务状态追踪**
```typescript
interface BackgroundTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  queuedAt: Date
  startedAt?: Date
  completedAt?: Date
  sessionID?: string
  // ... 详细元数据
}
```

3. **智能批处理**
```typescript
// 合并同一父任务的通知
private notificationQueueByParent: Map<string, Promise<void>>

// 批量上报，避免通知洪水
await batchNotify(parentSessionID)
```

**为什么 PAI 需要**:
- ✅ 并行 Research 代理时不会超限
- ✅ Council 辩论可以真正并行（不是串行）
- ✅ 任务失败自动重试
- ✅ 自动清理僵尸任务

---

### 2.2 Todo Continuation Enforcer（优先级：P0）

**代码位置**: `src/hooks/todo-continuation-enforcer/` (2061 lines)

**核心问题**:
```
用户: "帮我实现这个功能"
AI: [写了200行代码]
    [任务完成？停止]
用户: "继续，还没完成"
AI: "哦，我需要继续..."
```

**oh-my-opencode 解决方案**:
```typescript
export function createTodoContinuationEnforcer() {
  return {
    name: 'todo_continuation_enforcer',
    event: {
      'session.stop': async ({ sessionID }) => {
        // 1. 提取未完成的 TODO
        const todos = await getTodos(sessionID)
        const incomplete = todos.filter(t => t.status !== 'completed')

        if (incomplete.length > 0) {
          // 2. 保存到持久化存储
          await savePersistentState(sessionID, {
            incompleteTodos: incomplete,
            resumeContext: await getResumeContext(sessionID)
          })

          // 3. 下次自动恢复
          console.log(`💾 Preserved ${incomplete.length} incomplete tasks`)
        }
      }
    }
  }
}
```

**关键机制**:

1. **TODO 状态检查**
```typescript
// 检测所有未完成项
const hasIncomplete = (todos) => {
  return todos.some(t =>
    t.status === 'pending' ||
    t.status === 'in_progress'
  )
}

// 强制继续
if (hasIncomplete(todos)) {
  return "⚠️ INCOMPLETE: You must continue working on:"
}
```

2. **持久化恢复**
```typescript
// 保存到 .opencode/sessions/[sessionID].json
{
  "incompleteTodos": [...],
  "resumeContext": {
    "lastMessage": "...",
    "cwd": "/path/to/project",
    "environment": {...}
  }
}
```

3. **Session Compaction 集成**
```typescript
// 在压缩会话时保留 TODO
experimental.session.compacting: async (input, output) => {
  const preserved = await compactionTodoPreserver(input.sessionID)

  // 确保不会丢失任务
  if (preserved) {
    output.context.push(preserved)
  }
}
```

**为什么 PAI 需要**:
- ✅ 防止"假完成"
- ✅ 多会话工作不丢失进度
- ✅ 真正的任务追踪

---

### 2.3 分层 Hook 架构（优先级：P1）

**代码位置**: `src/plugin/hooks/`

**设计模式**:
```typescript
// 3 层职责分离
createHooks()
├── Core Hooks (20个)
│   ├── Session: 上下文窗口监控、恢复
│   ├── Tool Guard: 评论检查、输出截断
│   └── Transform: 关键词检测、规则注入
├── Continuation Hooks (7个)
│   ├── Stop Continuation Guard
│   ├── TODO Preserver
│   └── Atlas (orchestrator)
└── Skill Hooks (2个)
    ├── Category Reminder
    └── Auto Slash Command
```

**关键优势**:

1. **职责分离**
```typescript
// 每层关注点不同
Core:        会话、工具、消息  // 通用功能
Continuation: 任务延续        // 工作流
Skill:       技能特定          // 领域逻辑
```

2. **组合性**
```typescript
// 可以选择性启用
const hooks = {
  ...core,           // 总是启用
  ...continuation,    // 可选
  ...skill           // 按需加载
}
```

3. **可测试性**
```typescript
// 每层独立测试
test('Session hooks', () => {
  const core = createCoreHooks(...)
  expect(core.sessionRecovery).toBeDefined()
})
```

**PAI 当前的扁平结构**:
```typescript
// PAI: 所有 hooks 平铺
const hooks = {
  startupGreeting,
  updateTabTitle,
  loadContext,
  securityValidator,
  formatEnforcer,
  // ... 混在一起
}
```

**问题**:
- ❌ 难以找到相关 hooks
- ❌ 无法选择性禁用某层
- ❌ 测试困难

---

### 2.4 Category Routing（优先级：P1）

**代码位置**: `src/tools/delegate-task/constants.ts` (569 lines)

**核心概念**:
```typescript
// 按任务类型自动路由到最佳 Agent
const categories = {
  'visual': {
    agent: 'multimodal-looker',
    model: 'google/gemini-3-flash',
    reason: '图像分析首选 Gemini'
  },
  'business-logic': {
    agent: 'sisyphus-junior',
    model: 'anthropic/claude-sonnet-4-5',
    reason: '业务逻辑用 Sonnet 性价比高'
  },
  'research': {
    agent: 'librarian',
    model: 'zai-coding-plan/glm-4.7',
    reason: '搜索文档便宜快速'
  }
  // ... 20+ categories
}

// 自动检测 + 自动路由
const detected = detectCategory(userPrompt)
const route = categories[detected]
```

**PAI 对比**:
```typescript
// PAI: 手动指定
"Use Research skill"
"Use Browser skill"
"Use Art skill"

// oh-my-opencode: 自动路由
"帮我分析这个网页" → [visual] → multimodal-looker
"修复这个 bug" → [debug] → oracle
"重构这个文件" → [refactor] → sisyphus (LSP)
```

**优势**:
- ✅ 用户不需要知道细节
- ✅ 自动选择最合适的工具
- ✅ 成本优化（便宜模型做简单任务）

---

### 2.5 JSONC + Zod Schema（优先级：P2）

**代码位置**: `src/config/schema/` (21 个文件)

**设计**:
```typescript
// 21 个组件化的 schema
schema/
├── agent.ts          // Agent 配置
├── background-task.ts // 并发配置
├── category.ts       // 路由配置
├── command.ts        // 命令配置
├── hook.ts          // Hook 配置
├── mcp.ts           // MCP 配置
├── skill.ts         // 技能配置
└── ... (14+ 更多)

// 组合成主 schema
export const OhMyOpenCodeConfigSchema = z.object({
  agents: z.record(AgentConfigSchema),
  background_task: BackgroundTaskConfigSchema,
  categories: z.record(CategoryConfigSchema),
  // ...
})

// 自动生成 JSON Schema
export const jsonSchema = generateJsonSchema(
  OhMyOpenCodeConfigSchema
)
```

**关键特性**:

1. **类型推导**
```typescript
// IDE 自动补全
const config: OhMyOpenCodeConfig = {
  agent: { // 自动提示可用字段
    model: "...",
    temperature: 0.1
  }
}
```

2. **运行时验证**
```typescript
// 启动时验证配置
const result = OhMyOpenCodeConfigSchema.safeParse(userConfig)

if (!result.success) {
  // 清晰的错误信息
  console.error(ZodErrorFormatter(result.error))
  process.exit(1)
}
```

3. **自动文档**
```typescript
// 从 schema 生成文档
$ bun run build:schema
# 生成 oh-my-opencode.schema.json
# IDE 可以用它做验证
```

**PAI 对比**:
```yaml
# PAI: YAML frontmatter，无验证
name: Research
descriptin: "..."
mdel: claude-opus-4-6  # 拼写不会报错！
```

**问题**:
- ❌ 拼字无法检测
- ❌ 无类型提示
- ❌ 无运行时验证

---

### 2.6 Session Recovery（优先级：P1）

**代码位置**: `src/hooks/session-recovery/` (1279 lines)

**核心问题**:
```
场景：AI 在写代码时崩溃了
当前：丢失上下文，重新开始
期望：自动恢复，继续工作
```

**解决方案**:
```typescript
export function createSessionRecovery() {
  return {
    name: 'session_recovery',
    event: {
      'session.created': async ({ sessionID }) => {
        // 1. 检查是否有崩溃证据
        const crashEvidence = await findCrashEvidence(sessionID)

        if (crashEvidence) {
          // 2. 分析崩溃原因
          const analysis = await analyzeCrash(crashEvidence)

          // 3. 尝试恢复
          await attemptRecovery(sessionID, {
            lastState: crashEvidence.lastState,
            failedOperation: crashEvidence.operation,
            recoveryStrategy: analysis.strategy
          })
        }
      }
    }
  }
}
```

**恢复策略**:
```typescript
const strategies = {
  'context_window_exceeded': {
    action: 'truncate_history',
    params: { keep: 'last_50_messages' }
  },
  'rate_limit': {
    action: 'wait_and_retry',
    params: { backoff: 'exponential' }
  },
  'model_error': {
    action: 'switch_model',
    params: { fallback: 'sonnet' }
  },
  'timeout': {
    action: 'reduce_parallelism',
    params: { max_parallel: 1 }
  }
}
```

---

### 2.7 TDD 测试文化（优先级：P2）

**代码位置**: `176 个 *.test.ts` 文件

**统计**:
```bash
$ bun test
# 176 个测试文件
# 117,000+ 行测试代码
# BDD 风格: #given, #when, #then
```

**示例**:
```typescript
// red-green-refactor 循环
test('BackgroundManager.launch() creates task', async () => {
  //#given
  const manager = new BackgroundManager(ctx, config)

  //#when
  const task = await manager.launch({
    agent: 'test',
    description: 'test task'
  })

  //#then
  expect(task.status).toBe('pending')
  expect(task.id).toMatch(/^bg_[a-f0-9]{8}$/)
})
```

**PAI 对比**:
```bash
# PAI: VERIFY.md (手工验证)
$ bash ~/.claude/verify-opencode-integration.sh
# 没有自动化测试
```

---

## 🎯 三、吸收方案（优先级排序）

### Phase 1: P0 核心功能（立即实施）

#### **1.1 Todo Continuation Enforcer**

**目标**: 防止 AI 假装完成

**实施步骤**:

1. **创建新 Pack**
```bash
cd ~/Code/PAI/Packs
mkdir pai-todo-enforcer-skill
cd pai-todo-enforcer-skill
```

2. **目录结构**
```
pai-todo-enforcer-skill/
├── SKILL.md
├── Hooks/
│   ├── SessionStop.hook.md
│   └── SessionStart.hook.md
├── Tools/
│   ├── CheckTodos.ts
│   ├── PersistState.ts
│   └── RestoreState.ts
└── Workflows/
    └── ResumeWork.md
```

3. **核心实现**
```typescript
// Tools/CheckTodos.ts
export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  id: string
}

export async function checkTodos(sessionID: string) {
  // 从 session metadata 获取 TODO
  const todos = await getTodos(sessionID)

  const incomplete = todos.filter(t =>
    t.status !== 'completed' && t.status !== 'cancelled'
  )

  return {
    hasIncomplete: incomplete.length > 0,
    incomplete,
    canComplete: incomplete.length === 0
  }
}
```

4. **Hook 实现**
```markdown
<!-- Hooks/SessionStop.hook.md -->
## Hook: session.stop

**Trigger**: 当会话结束时执行

### Logic

1. 检查未完成的 TODO:
   ```typescript
   const result = await CheckTodos(sessionID)
   ```

2. 如果有未完成任务:
   - 保存到 `~/.claude/MEMORY/STATE/sessions/[sessionID].json`
   - 包含: incomplete todos, resume context, timestamp

3. 生成恢复提示:
   ```
   💾 已保存 ${incomplete.length} 个未完成任务
   恢复命令: resume ${sessionID}
   ```

### Implementation

使用 `~/.claude/skills/CORE/Tools/SessionProgress.ts`
```

5. **集成到 pai-core-install**
```bash
# 在 pai-core-install 的 INSTALL.md 中添加
- "pai-todo-enforcer-skill" 作为依赖
```

**工作量**: 2-3 天
**测试**:
- 创建任务，停止会话
- 重新打开，验证恢复
- 跨会话任务追踪

---

#### **1.2 Background Agent Manager**

**目标**: 真正的并行任务执行

**实施步骤**:

1. **创建新 Pack**
```bash
mkdir ~/Code/PAI/Packs/pai-background-manager
cd pai-background-manager
```

2. **目录结构**
```
pai-background-manager/
├── SKILL.md
├── src/
│   ├── BackgroundManager.ts     # 主管理器
│   ├── ConcurrencyManager.ts    # 并发控制
│   ├── TaskQueue.ts           # 队列管理
│   └── types.ts              # 类型定义
└── tests/
    ├── BackgroundManager.test.ts
    └── ConcurrencyManager.test.ts
```

3. **核心实现** (简化版)
```typescript
// src/BackgroundManager.ts
export class BackgroundManager {
  private tasks: Map<string, BackgroundTask>
  private queues: Map<string, BackgroundTask[]>
  private concurrency: ConcurrencyManager

  constructor(
    private ctx: PluginContext,
    config: BackgroundConfig
  ) {
    this.concurrency = new ConcurrencyManager(config.limits)
  }

  async launch(input: LaunchInput): Promise<string> {
    // 1. 检查并发限制
    if (!this.concurrency.canLaunch(input.provider, input.model)) {
      return this.enqueue(input)  // 排队
    }

    // 2. 创建任务
    const task = this.createTask(input)

    // 3. 启动执行
    return this.execute(task)
  }

  private async execute(task: BackgroundTask): Promise<string> {
    // 使用 ctx.client.runSubagent()
    const session = await this.ctx.client.runSubagent({
      agent: task.agent,
      prompt: task.prompt,
      model: task.model
    })

    task.sessionID = session.id
    task.status = 'running'

    // 4. 轮询状态
    return this.poll(task.id)
  }
}
```

4. **并发控制**
```typescript
// src/ConcurrencyManager.ts
export class ConcurrencyManager {
  private limits: Map<string, ConcurrencyLimit>
  private running: Map<string, number>

  canLaunch(provider: string, model: string): boolean {
    const limit = this.limits.get(provider)
    const running = this.running.get(`${provider}:${model}`) || 0

    return running < limit.max
  }

  async acquire(provider: string, model: string) {
    this.running.set(`${provider}:${model}`,
      (this.running.get(`${provider}:${model}`) || 0) + 1
    )
  }

  release(provider: string, model: string) {
    this.running.set(`${provider}:${model}`,
      Math.max(0, (this.running.get(`${provider}:${model}`) || 0) - 1)
    )
  }
}
```

5. **PAI 集成**
```typescript
// 在 pai-agents-skill 中添加
export async function spawnParallelAgents(count: number, config: AgentConfig) {
  const bgManager = new BackgroundManager(getContext(), {
    limits: {
      'anthropic': { opus: 2, sonnet: 5 },
      'openai': { gpt5: 5 }
    }
  })

  const tasks = await Promise.all(
    Array.from({ length: count }, () =>
      bgManager.launch(config)
    )
  )

  return tasks
}
```

**工作量**: 5-7 天
**测试**:
- 并行 10 个 Librarian 代理
- 验证并发限制
- 测试错误恢复

---

### Phase 2: P1 架构增强（短期实施）

#### **2.1 分层 Hook 架构重构**

**当前问题**:
```typescript
// PAI: 14 个 hooks 平铺
skills/CORE/Hooks/
├── QuestionAnswered.hook.md
├── UpdateTabTitle.hook.md
├── LoadContext.hook.md
├── ImplicitSentimentCapture.hook.md
├── SecurityValidator.hook.md
└── ... (14 个文件混合)
```

**重构目标**:
```
skills/CORE/Hooks/
├── Core/
│   ├── Session/
│   │   ├── StartupGreeting.hook.md
│   │   └── LoadContext.hook.md
│   ├── Tool/
│   │   ├── SecurityValidator.hook.md
│   │   └── FormatEnforcer.hook.md
│   └── Transform/
│       ├── UpdateTabTitle.hook.md
│       └── ImplicitSentimentCapture.hook.md
├── Continuation/
│   ├── TODOEnforcer.hook.md
│   └── SessionRecovery.hook.md
└── Skill/
    └── CategoryRouter.hook.md
```

**实施步骤**:

1. **迁移工具**
```bash
# 创建迁移脚本
cat > ~/Code/PAI/Packs/pai-hook-system/tools/migrate-hooks.ts <<'EOF'
export async function migrateToLayeredHooks() {
  // 1. 读取现有 hooks
  const existingHooks = await glob('*.hook.md', {
    cwd: 'src/hooks'
  })

  // 2. 分类
  const categorized = categorizeHooks(existingHooks)

  // 3. 移动到新结构
  for (const [layer, hooks] of Object.entries(categorized)) {
    await mkdirp(`src/hooks/${layer}`)
    await Promise.all(
      hooks.map(h => rename(h, `${layer}/${h}`))
    )
  }
}

function categorizeHooks(hooks: string[]) {
  return {
    'Core/Session': ['StartupGreeting', 'LoadContext'],
    'Core/Tool': ['SecurityValidator', 'FormatEnforcer'],
    'Core/Transform': ['UpdateTabTitle', 'ImplicitSentimentCapture'],
    'Continuation': ['TODOEnforcer', 'SessionRecovery'],
    'Skill': ['CategoryRouter']
  }
}
EOF
```

2. **更新 Hook 加载器**
```typescript
// pai-hook-system/src/index.ts
export async function loadHooks() {
  const layers = {
    core: await loadLayer('Core'),
    continuation: await loadLayer('Continuation'),
    skill: await loadLayer('Skill')
  }

  // 按层启用/禁用
  return {
    ...layers.core,
    ...(config.continuationEnabled ? layers.continuation : {}),
    ...(config.skillEnabled ? layers.skill : {})
  }
}
```

**工作量**: 3-4 天
**风险**: 低（重构，不改变功能）

---

#### **2.2 Category Routing System**

**目标**: 自动任务路由

**实施步骤**:

1. **在 pai-agents-skill 添加**
```bash
mkdir -p ~/Code/PAI/Packs/pai-agents-skill/src/skills/Agents/Categories
```

2. **定义 Categories**
```typescript
// Categories/definitions.ts
export const CATEGORY_DEFINITIONS = {
  visual: {
    agents: ['multimodal-looker'],
    models: ['google/gemini-3-flash'],
    reason: '图像分析专用',
    keywords: ['图片', '截图', '图表', 'pdf', 'image']
  },
  research: {
    agents: ['librarian', 'explore'],
    models: ['zai-coding-plan/glm-4.7', 'xai/grok'],
    reason: '文档搜索和代码探索',
    keywords: ['搜索', '查找', '探索', 'research', '文档']
  },
  debug: {
    agents: ['oracle'],
    models: ['openai/gpt-5.2'],
    reason: '调试和架构分析',
    keywords: ['bug', '错误', '调试', '不工作', 'debug']
  },
  refactor: {
    agents: ['sisyphus'],
    models: ['anthropic/claude-sonnet-4-5'],
    reason: '代码重构',
    keywords: ['重构', '优化', '整理', 'refactor']
  }
}
```

3. **检测器**
```typescript
// Categories/detector.ts
export function detectCategory(prompt: string): string | null {
  const scores = {}

  for (const [category, def] of Object.entries(CATEGORY_DEFINITIONS)) {
    const matchCount = def.keywords.filter(kw =>
      prompt.toLowerCase().includes(kw.toLowerCase())
    ).length

    scores[category] = matchCount
  }

  // 返回最高分
  const maxScore = Math.max(...Object.values(scores))
  if (maxScore === 0) return null

  return Object.keys(scores).find(key => scores[key] === maxScore)
}
```

4. **路由器**
```typescript
// Categories/router.ts
export async function routeTask(prompt: string) {
  const category = detectCategory(prompt)

  if (!category) {
    return null  // 无明确类别，使用默认
  }

  const def = CATEGORY_DEFINITIONS[category]

  return {
    agent: def.agents[0],  // 选择第一个
    model: def.models[0],
    category,
    confidence: 'high'
  }
}
```

5. **集成到 Agents Skill**
```markdown
<!-- SKILL.md 更新 -->

## Workflow: AutoRouting

当用户请求任务时：

1. **检测类别**:
   ```typescript
   const route = await routeTask(userPrompt)
   ```

2. **如果有明确路由**:
   - 显示: "🎯 检测到 ${route.category} 任务"
   - 使用: ${route.agent} + ${route.model}

3. **否则**:
   - 使用默认 Agent（当前行为）
```

**工作量**: 2-3 天
**测试**:
- "帮我研究这个 API" → research
- "这里有个 bug" → debug
- "重构这段代码" → refactor

---

#### **2.3 Session Recovery**

**目标**: 崩溃后自动恢复

**实施步骤**:

1. **创建新 Hook**
```bash
# 在 pai-hook-system
mkdir -p Hooks/Continuation
```

2. **实现**
```markdown
<!-- Hooks/Continuation/SessionRecovery.hook.md -->

## Trigger: session.created

### Logic

1. **检测崩溃证据**:
   ```bash
   # 查找未关闭的会话
   ls -t ~/.claude/MEMORY/WORK/sessions/ | head -5
   ```

2. **分析崩溃原因**:
   - 上下文窗口超限?
   - 速率限制?
   - 模型错误?
   - 超时?

3. **生成恢复提示**:
   ```
   ⚠️ 检测到上次会话异常中断

   原因: ${crashReason}
   策略: ${recoveryStrategy}

   [自动恢复中...]
   ```

4. **执行恢复**:
   - 清理状态
   - 调整参数
   - 重新开始任务

### Implementation

使用 FormatEnforcer 的 `last_error` 检测
```

**工作量**: 3-4 天
**测试**:
- 模拟上下文超限
- 验证自动截断历史
- 测试恢复策略

---

### Phase 3: P2 长期改进（后续实施）

#### **3.1 JSONC + Zod Schema**

**目标**: 类型安全的配置

**实施步骤**:

1. **添加 Zod 依赖**
```bash
cd ~/Code/PAI
bun add zod
```

2. **创建 Schema 定义**
```typescript
// Packs/pai-core-install/src/config/schema.ts
import { z } from 'zod'

export const SkillConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  temperature: z.number().min(0).max(1).optional()
})

export const PackConfigSchema = z.object({
  name: z.string(),
  version: z.string(),
  skills: z.array(SkillConfigSchema)
})

export const PAIConfigSchema = z.object({
  packs: z.array(PackConfigSchema),
  user: z.object({
    name: z.string(),
    daName: z.string(),
    timezone: z.string()
  }).optional()
})
```

3. **验证器**
```typescript
// 验证 SKILL.md frontmatter
export async function validateSkillConfig(skillPath: string) {
  const content = await readFile(skillPath, 'utf-8')
  const frontmatter = extractFrontmatter(content)

  const result = SkillConfigSchema.safeParse(frontmatter)

  if (!result.success) {
    console.error('❌ Invalid config:')
    console.error(ZodErrorFormatter(result.error))
    return false
  }

  return true
}
```

4. **自动补全**
```typescript
// 生成 JSON Schema
bun run build:schema
# 生成 .claude/skills.schema.json
# VS Code 可以用它做验证
```

**工作量**: 4-5 天
**价值**: 长期维护性

---

#### **3.2 TDD 测试框架**

**目标**: 自动化测试

**实施步骤**:

1. **设置测试框架**
```bash
cd ~/Code/PAI
bun add -D bun-types @types/bun
```

2. **第一个测试**
```typescript
# Packs/pai-agents-skill/AgentFactory.test.ts
import { describe, test, expect } from 'bun:test'
import { createAgent } from './AgentFactory'

describe('AgentFactory', () => {
  test('should create agent with traits', () => {
    //#given
    const traits = {
      expertise: 'security',
      personality: 'skeptical',
      approach: 'thorough'
    }

    //#when
    const agent = createAgent(traits)

    //#then
    expect(agent.expertise).toBe('security')
    expect(agent.personality).toBe('skeptical')
  })
})
```

3. **BDD 风格**
```typescript
test('spawnParallel creates multiple agents', async () => {
  //#given
  const count = 5

  //#when
  const agents = await spawnParallelAgents(count)

  //#then
  expect(agents).toHaveLength(count)
  expect(agents[0].id).toBeDefined()
})
```

4. **CI 集成**
```yaml
# .github/workflows/test.yml
name: Test
on: [push]
steps:
  - run: bun test
```

**工作量**: 持续改进
**价值**: 代码质量保证

---

## 📋 四、实施计划

### 4.1 优先级矩阵

| 功能 | 优先级 | 工作量 | 价值 | 风险 |
|------|--------|--------|------|------|
| Todo Continuation Enforcer | P0 | 2-3天 | 高 | 低 |
| Background Agent Manager | P0 | 5-7天 | 极高 | 中 |
| 分层 Hook 架构 | P1 | 3-4天 | 中 | 低 |
| Category Routing | P1 | 2-3天 | 高 | 低 |
| Session Recovery | P1 | 3-4天 | 高 | 中 |
| JSONC + Zod Schema | P2 | 4-5天 | 中 | 低 |
| TDD 测试框架 | P2 | 持续 | 中 | 低 |

### 4.2 时间表

**Sprint 1 (Week 1-2): P0 功能**
- Day 1-3: Todo Continuation Enforcer
- Day 4-10: Background Agent Manager
- Day 11-14: 测试和文档

**Sprint 2 (Week 3-4): P1 架构**
- Day 15-18: 分层 Hook 架构
- Day 19-21: Category Routing
- Day 22-25: Session Recovery
- Day 26-28: 测试和文档

**Sprint 3 (Week 5+): P2 改进**
- JSONC + Zod Schema
- TDD 测试框架
- 持续迭代

### 4.3 并行任务

**可以同时进行**:
- ✅ Todo Enforcer + Hook 重构（不冲突）
- ✅ Category Routing + Schema（独立）
- ✅ Session Recovery + Background Manager（互补）

**必须串行**:
- ❌ Hook 重构 → Category Routing（依赖新架构）
- ❌ Background Manager → 并行测试（依赖 Manager）

---

## 🚀 五、快速启动指南

### 5.1 创建功能分支

```bash
cd ~/Code/PAI

# 确保在 main
git checkout main
git pull upstream main --no-edit

# 创建功能分支
git checkout -b feature/enhancement-p0

# 或一次性 P0
git checkout -b feature/p0-enhancements
```

### 5.2 开始实施

**选项 A: Todo Enforcer（推荐先做）**
```bash
# 创建 Pack
mkdir -p Packs/pai-todo-enforcer-skill/{Hooks,Tools,Workflows}

# 复制模板
cp Packs/pai-agents-skill/src/skills/Agents/SKILL.md \
   Packs/pai-todo-enforcer-skill/

# 开始实现
# ... 编辑 SKILL.md ...
# ... 创建 Hooks/SessionStop.hook.md ...
# ... 实现 Tools/CheckTodos.ts ...
```

**选项 B: Background Manager（复杂但有价值）**
```bash
# 创建 Pack
mkdir -p Packs/pai-background-manager/{src,tests,SKILL.md}

# 从 oh-my-opencode 学习
# 阅读: ~/Code/oh-my-opencode/src/features/background-agent/manager.ts

# 简化实现
# ... 创建 BackgroundManager.ts ...
# ... 创建 ConcurrencyManager.ts ...
# ... 添加测试 ...
```

### 5.3 提交流程

```bash
# 本地测试
bun test  # 如果有测试
# 或
bash ~/.claude/verify-opencode-integration.sh

# 提交
git add .
git commit -m "feat(p0): add Todo Continuation Enforcer

- 检测未完成任务
- 持久化到 MEMORY/STATE/
- 自动恢复机制

Closes #[issue-number]"

# 推送到你的 fork
git push origin feature/enhancement-p0
```

### 5.4 创建 Pull Request

```bash
# 打开 PR 到你的 fork
gh pr create --title "feat(p0): P0 Enhancements from oh-my-opencode" \
  --body "详见 PAI/ENHANCEMENT_PLAN.md"
```

---

## 📊 六、成功指标

### 6.1 功能指标

- ✅ **TODO 完成率**: 从 60% → 95%
- ✅ **并行任务**: 从 1 个 → 10 个同时运行
- ✅ **会话恢复**: 从 0% → 80% 自动恢复
- ✅ **任务路由**: 从手动 → 自动（80% 准确率）

### 6.2 质量指标

- ✅ **Hook 数量**: 14 → 30+ (分层后)
- ✅ **测试覆盖**: 0% → 40%+
- ✅ **类型安全**: 部分 → 100% (Zod 验证)

### 6.3 用户体验

- ✅ **假完成**: 每周 < 1 次
- ✅ **任务丢失**: 0 次
- ✅ **配置错误**: 启动时自动检测
- ✅ **文档**: 每个功能都有使用示例

---

## 🎓 七、学习资源

### 7.1 oh-my-opencode 代码

**必读文件**:
```
~/Code/oh-my-opencode/
├── src/features/background-agent/manager.ts   # 并发管理
├── src/hooks/todo-continuation-enforcer/    # TODO 强制
├── src/hooks/session-recovery/              # 会话恢复
├── src/tools/delegate-task/constants.ts    # 路由定义
└── src/config/schema/                     # Zod schemas
```

### 7.2 设计模式

**Factory Pattern**:
```typescript
// oh-my-opencode: 统一的创建接口
const hook = isHookEnabled("name")
  ? safeCreateHook("name", factory, { enabled })
  : null
```

**Strategy Pattern**:
```typescript
// Session Recovery: 不同错误不同策略
const strategies = {
  'context_exceeded': truncateStrategy,
  'rate_limit': backoffStrategy,
  'model_error': switchModelStrategy
}
```

**Observer Pattern**:
```typescript
// Background Manager: 事件驱动
onSubagentSessionCreated: async (event) => {
  await tmuxSessionManager.onSessionCreated(event)
}
```

---

## ✅ 八、验证清单

实施每个功能前，确认：

- [ ] 阅读了 oh-my-opencode 源码
- [ ] 理解了设计模式
- [ ] 创建了功能分支
- [ ] 编写了测试（TDD）
- [ ] 更新了文档（SKILL.md）
- [ ] 本地验证通过
- [ ] 推送到 fork
- [ ] 创建了 PR

---

**生成时间**: 2026-02-13
**下次更新**: 实施 P0 后复盘
**维护人**: 千千
