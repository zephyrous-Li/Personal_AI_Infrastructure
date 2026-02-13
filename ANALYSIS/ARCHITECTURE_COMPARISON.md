# 架构对比可视化

## 一、Hook 系统架构对比

### PAI v2.5（扁平结构）
```
┌────────────────────────────────────────────────────┐
│              PAI Hook 系统 (14 hooks)        │
├────────────────────────────────────────────────────┤
│                                               │
│  StartupGreeting        ○── 启动问候          │
│  UpdateTabTitle         ○── 标题更新          │
│  LoadContext           ○── 加载上下文         │
│  SecurityValidator      ○── 安全验证           │
│  FormatEnforcer        ○── 格式强制           │
│  CheckVersion          ○── 版本检查           │
│  QuestionAnswered      ○── 问题回答           │
│  SetQuestionTab        ○── 设置问题标签        │
│  AgentOutputCapture    ○── 代理输出捕获        │
│  AutoWorkCreation      ○── 自动工作创建        │
│  ImplicitSentiment     ○── 隐式情感捕获        │
│  (4 more...)          ○── 其他              │
│                                               │
│  ❌ 问题:                                     │
│  - 难以找到相关 hooks                     │
│  - 无法分层禁用                            │
│  - 职责混杂                               │
└────────────────────────────────────────────────────┘
```

### oh-my-opencode v3.5（分层架构）
```
┌────────────────────────────────────────────────────┐
│        oh-my-opencode Hook 系统 (41 hooks)     │
├────────────────────────────────────────────────────┤
│                                               │
│  ┌───────────────────────────────────────┐     │
│  │ Core Hooks (20)                    │     │
│  ├───────────────────────────────────────┤     │
│  │  Session:  7 hooks                 │     │
│  │    ├─ contextWindowMonitor            │     │
│  │    ├─ sessionRecovery              │     │
│  │    ├─ thinkMode                   │     │
│  │    └─ ... (4 more)               │     │
│  │                                      │     │
│  │  ToolGuard: 8 hooks                 │     │
│  │    ├─ commentChecker                │     │
│  │    ├─ toolOutputTruncator           │     │
│  │    ├─ rulesInjector               │     │
│  │    └─ ... (5 more)               │     │
│  │                                      │     │
│  │  Transform: 4 hooks                 │     │
│  │    ├─ keywordDetector               │     │
│  │    ├─ contextInjector             │     │
│  │    └─ ... (2 more)               │     │
│  └───────────────────────────────────────┘     │
│                                               │
│  ┌───────────────────────────────────────┐     │
│  │ Continuation Hooks (7)               │     │
│  ├───────────────────────────────────────┤     │
│  │  ├─ stopContinuationGuard           │     │
│  │  ├─ compactionTodoPreserver          │     │
│  │  ├─ todoContinuationEnforcer ← 🎯   │     │
│  │  ├─ atlas (orchestrator)            │     │
│  │  └─ ... (3 more)                 │     │
│  └───────────────────────────────────────┘     │
│                                               │
│  ┌───────────────────────────────────────┐     │
│  │ Skill Hooks (2)                    │     │
│  ├───────────────────────────────────────┤     │
│  │  ├─ categorySkillReminder           │     │
│  │  └─ autoSlashCommand               │     │
│  └───────────────────────────────────────┘     │
│                                               │
│  ✅ 优势:                                     │
│  - 职责清晰，易维护                       │
│  - 可以分层禁用                            │
│  - 易于扩展和测试                          │
└────────────────────────────────────────────────────┘
```

---

## 二、任务管理对比

### PAI: The Algorithm（任务流程）
```
用户请求
    ↓
OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN
    ↓
  [单线程执行]
    ↓
任务完成？
  ├─ YES → 结束
  └─ NO  →  [用户手动说"继续"]
```

**问题**:
- ❌ 无并发生态
- ❌ 无任务持久化
- ❌ 无自动恢复
- ❌ 容易"假完成"

### oh-my-opencode: Background Manager（任务系统）
```
用户请求
    ↓
┌──────────────────────────────────────┐
│      BackgroundManager                │
│  ┌────────────────────────────┐   │
│  │ ConcurrencyManager           │   │
│  │ ├─ anthropic: 5          │   │
│  │ ├─ openai: 10            │   │
│  │ └─ google: 3             │   │
│  └────────────────────────────┘   │
│                                  │
│  任务队列                       │
│  ┌─────┬─────┬─────┬─────┐  │
│  │ T1  │ T2  │ T3  │ T4  │  │
│  └──┬──┴──┬──┴──┬──┴──┬──┘  │
│     ↓    ↓    ↓    ↓         │
│  [并发执行]                   │
│     ↓    ↓    ↓    ↓         │
│  [轮询状态]                   │
│     ↓    ↓    ↓    ↓         │
│  [批量通知]                   │
└──────────────────────────────────────┘
    │
    ↓
TODO Continuation Enforcer
    ↓
检查: 所有关闭？
  ├─ YES → 完成
  └─ NO  → 保存状态 → 下次恢复
```

**优势**:
- ✅ 真正并行执行
- ✅ 任务持久化
- ✅ 自动恢复
- ✅ 防止"假完成"

---

## 三、配置系统对比

### PAI: SKILL.md (YAML Frontmatter)
```yaml
---
name: Research
description: "Multi-source research"
model: claude-opus-4-6
agent: librarian
temperature: 0.1
---
# Skill instruction...
```

**问题**:
- ❌ `m odel` → 拼字不报错
- ❌ 无类型提示
- ❌ 无运行时验证
- ❌ JSONC 支持弱

### oh-my-opencode: Zod Schema (Type-Safe)
```typescript
import { z } from "zod"

const SkillConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  model: z.string().refine(
    s => /^[a-z]+\/[a-z0-9-]+$/.test(s),
    { message: "Invalid model format" }
  ),
  agent: z.string().optional(),
  temperature: z.number()
    .min(0)
    .max(1)
    .optional()
})

// ✅ 类型推导
const config: SkillConfig = { ... }
//     ^^^^^ IDE 自动补全

// ✅ 运行时验证
const result = SkillConfigSchema.safeParse(userConfig)
if (!result.success) {
  console.error(ZodErrorFormatter(result.error))
}

// ✅ 自动生成 JSON Schema
// $ bun run build:schema
```

**优势**:
- ✅ 类型安全
- ✅ IDE 自动补全
- ✅ 运行时验证
- ✅ 清晰的错误提示

---

## 四、代理路由对比

### PAI: 手动指定
```
用户: "研究 Kubernetes"
千千: "使用 Research Skill..."

用户: "分析这个 PDF"
千千: "使用 Documents Skill..."

用户: "创建架构图"
千千: "使用 Art Skill..."
```

**问题**:
- ❌ 用户需要知道哪个 Skill 做什么
- ❌ 无自动优化
- ❌ 无法选择最佳模型

### oh-my-opencode: Category Routing
```
用户: "研究 Kubernetes"
    ↓
[关键词匹配: research]
    ↓
自动路由 → Librarian (GLM-4.7)
    原因: 便宜 + 快速

用户: "分析这个 PDF"
    ↓
[关键词匹配: visual]
    ↓
自动路由 → Multimodal-Looker (Gemini-3-Flash)
    原因: 多模态支持

用户: "重构代码"
    ↓
[关键词匹配: refactor]
    ↓
自动路由 → Sisyphus (Sonnet-4-5)
    原因: 性价比 + 代码质量
```

**优势**:
- ✅ 自动选择最合适的工具
- ✅ 成本优化（便宜模型做简单任务）
- ✅ 用户体验更好

---

## 五、错误恢复对比

### PAI: Ralph Loop（自指涉循环）
```
执行任务
    ↓
出现错误？
  ├─ NO  → 完成
  └─ YES →
      ├─ 分析错误
      ├─ 调整策略
      ├─ 重新执行
      └─ [循环直到成功]
```

**问题**:
- ❌ 无崩溃恢复
- ❌ 会话中断丢失进度
- ❌ 无策略模式

### oh-my-opencode: Session Recovery（策略模式）
```
会话中断
    ↓
┌───────────────────────────────────┐
│     Session Recovery           │
│  ┌─────────────────────────┐ │
│  │ 检测崩溃证据         │ │
│  ├─ context_exceeded      │ │
│  ├─ rate_limit           │ │
│  ├─ model_error          │ │
│  └─ timeout             │ │
│  └─────────────────────────┘ │
│           ↓                   │
│  ┌─────────────────────────┐ │
│  │ 选择策略             │ │
│  ├─ truncate_history     │ │
│  ├─ wait_and_retry       │ │
│  ├─ switch_model        │ │
│  └─ reduce_parallelism  │ │
│  └─────────────────────────┘ │
└───────────────────────────────────┘
    ↓
自动恢复 + 保留进度
```

**优势**:
- ✅ 针对不同错误有不同策略
- ✅ 自动恢复
- ✅ 保留进度不丢失

---

## 六、测试对比

### PAI: 手工验证
```
PAI/Packs/pai-core-install/
├── INSTALL.md          # 安装指南
├── VERIFY.md           # 验证清单
└── SKILL.md           # 技能文档

# 安装后运行
$ bash verify-opencode-integration.sh
✅ Hook 1: PASS
✅ Hook 2: PASS
❌ Hook 3: FAIL
```

**问题**:
- ❌ 非自动化
- ❌ 无法持续集成
- ❌ 测试覆盖低

### oh-my-opencode: TDD (176 测试文件)
```
*.test.ts (176 files)
├── create-core-hooks.test.ts
├── background-manager.test.ts
├── todo-enforcer.test.ts
└── ...

# RED-GREEN-REFACTOR
test('BackgroundManager.launch()', async () => {
  //#given
  const manager = new BackgroundManager(ctx)

  //#when
  const task = await manager.launch({...})

  //#then
  expect(task.status).toBe('pending')
})

$ bun test
✓ 176/176 tests passed
Coverage: 87%
```

**优势**:
- ✅ 自动化测试
- ✅ CI/CD 集成
- ✅ 高覆盖率

---

## 七、关键差异总结

| 维度 | PAI | oh-my-opencode | 差距 |
|------|-----|-----------------|------|
| **Hook 系统** | 14 个（扁平） | 41 个（分层） | ⭐⭐⭐ |
| **并发控制** | 无 | ConcurrencyManager | ⭐⭐⭐ |
| **任务持久化** | 无 | BackgroundManager | ⭐⭐⭐ |
| **自动恢复** | Ralph Loop | Session Recovery | ⭐⭐ |
| **配置验证** | YAML | Zod Schema | ⭐⭐ |
| **自动路由** | 手动 | Category Routing | ⭐⭐ |
| **测试覆盖** | VERIFY.md | 176 tests | ⭐⭐⭐ |
| **错误恢复** | 单策略 | 多策略 | ⭐⭐ |
| **类型安全** | 部分 | 完整 | ⭐⭐ |

---

## 八、PAI 增强 ROI 分析

### P0 功能（高 ROI）

**Todo Continuation Enforcer**
- 工作量: 2-3 天
- 价值: ⭐⭐⭐
  - 防止"假完成"（每天节省 30 分钟）
  - 任务不丢失
  - 用户体验立即改善
- ROI: 极高

**Background Manager**
- 工作量: 5-7 天
- 价值: ⭐⭐⭐
  - 真正并行（10x 速度）
  - 成本控制
  - Council 真正并行
- ROI: 极高

### P1 功能（中 ROI）

**分层 Hook 架构**
- 工作量: 3-4 天
- 价值: ⭐⭐
  - 易于维护
  - 更好的扩展性
- ROI: 高

**Category Routing**
- 工作量: 2-3 天
- 价值: ⭐⭐⭐
  - 用户体验提升
  - 成本优化
- ROI: 极高

**Session Recovery**
- 工作量: 3-4 天
- 价值: ⭐⭐
  - 减少中断损失
  - 自动化
- ROI: 高

---

**结论**:
优先实施 **P0 功能** → Todo Enforcer + Background Manager
  - 投入: 1-2 周
  - 产出: 10x 并发 + 0 任务丢失
  - ROI: 极高

然后实施 **P1 功能** → 分层架构 + Category + Recovery
  - 投入: 2-3 周
  - 产出: 更好的维护性和体验
  - ROI: 高
