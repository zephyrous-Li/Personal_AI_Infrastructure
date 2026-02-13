# Todo Continuation - 方案对比与优化建议

**评估人**: 千千
**日期**: 2026-02-13

---

## 📊 一、当前方案效果评估

### 1.1 核心方案回顾

```
Stop Event → 解析 Transcript → 提取 TODO → 保存到 STATE/
                                                          ↓
SessionStart → 读取 STATE/ → 注入恢复提示 → 用户看到
```

### 1.2 效果预测

| 维度 | 效果 | 分析 |
|------|------|------|
| **防止假完成** | ⭐⭐⭐ (70%) | 在 Stop 时检测，但 AI 可能不更新 TODO 就喊"完成" |
| **跨会话恢复** | ⭐⭐⭐⭐ (90%) | 状态持久化可靠，SessionStart 能正确注入 |
| **用户体验** | ⭐⭐ (60%) | 无倒计时，无 Toast，只有文本提示 |
| **性能影响** | ⭐⭐⭐⭐⭐ (95%) | < 50ms，几乎无感知 |
| **可维护性** | ⭐⭐⭐⭐ (80%) | 独立 Hooks，代码简单 |

### 1.3 核心问题

**问题 1: 时间窗口太大**
```
用户: "帮我实现用户认证"
AI: [写了代码，调用 TodoWrite 更新状态]
AI: "任务完成！" ← ✅ 能检测到

BUT:
用户: "帮我写个测试"
AI: [写了代码，忘记调用 TodoWrite]
AI: "任务完成！" ← ❌ 检测不到（没 TodoWrite 调用）
```

**问题 2: 无法主动阻止**
- Stop Hook 只能"记录"和"下次提示"
- 无法像 oh-my-opencode 那样在 idle 时强制继续

**问题 3: 用户体验落差**
```
oh-my-opencode:
  用户等待 2 秒 → 倒计时 Toast → 自动继续

PAI 当前方案:
  用户关闭会话 → 重新打开 → 看到提示 → 手动继续
```

---

## 🔄 二、替代方案评估

### 方案 A: PreToolUse 实时拦截

**设计**:
```typescript
// PreToolUse Hook
if (tool_name === 'AskUserQuestion') {
  const lastTodoWrite = parseLastTodoWrite(transcript)
  const incomplete = extractIncomplete(lastTodoWrite)

  if (incomplete.length > 0) {
    // 检查 AI 是否打算假装完成
    const userPrompt = parseUserPrompt(transcript)
    const isCompleting = /完成|完成|done|finished/i.test(userPrompt)

    if (isCompleting) {
      return {
        decision: 'ask',
        message: `⚠️ 你还有 ${incomplete.length} 个任务未完成：\n${formatList(incomplete)}\n\n确定要结束吗？`
      }
    }
  }
}
```

**效果**:
- ✅ 实时拦截（在 AI 喊"完成"时）
- ✅ 用户确认后才结束
- ✅ 理论上 100% 防止假完成

**问题**:
- ❌ 过度打扰（每次完成都弹窗）
- ❌ 误判（可能用户真的想放弃某些任务）
- ❌ 依赖用户判断（可能误点"确定"）

**评分**: ⭐⭐ (60%)

---

### 方案 B: Stop + SessionStart + PreToolUse 混合

**设计**:
```
┌─────────────────────────────────────────────────────┐
│                    混合保护                      │
├─────────────────────────────────────────────────────┤
│                                                   │
│  PreToolUse ──► 轻量级检查                        │
│                  └─► 发现有完成意图                      │
│                      └─► 注入提醒（不弹窗）               │
│                                                   │
│  Stop ─────────► 完整检查 + 保存                    │
│                                                   │
│  SessionStart ──► 恢复 + 提醒                    │
│                                                   │
└─────────────────────────────────────────────────────┘
```

**PreToolUse 注入内容**:
```
💭 系统提示：你有 3 个未完成任务
- [ ] 完成用户认证
- [ ] 编写测试
- [ ] 更新文档

请继续工作，完成后标记为 completed。
```

**效果**:
- ✅ 实时提醒（不阻止）
- ✅ 多重保护（PreToolUse + Stop）
- ✅ 用户友好（不弹窗）

**问题**:
- ⚠️ AI 可能忽略提示
- ⚠️ 依然无法自动继续

**评分**: ⭐⭐⭐ (75%)

---

### 方案 C: 基于 Algorithm 的智能检测

**设计**:
```typescript
// 使用 IdealState 的 completion tracker
const completionRate = calculateCompletion(transcript)

Stop Event:
  if (completionRate < 0.8 && incompleteTodos.length > 0) {
    // AI 宣称完成，但实际完成率 < 80%
    injectWarning("⚠️ 检测到未完成的工作，请继续")
  }
```

**利用 PAI 独有优势**:
- ✅ Algorithm 已在追踪完成度
- ✅ 不依赖 TodoWrite 调用
- ✅ 更智能的判断

**效果**:
- ✅ 无需 AI 配合（不依赖 TodoWrite）
- ✅ 利用现有能力
- ✅ 更准确（基于实际完成度）

**问题**:
- ⚠️ 需要理解 IdealState 逻辑
- ⚠️ 可能与 Algorithm 的逻辑冲突

**评分**: ⭐⭐⭐⭐ (80%)

---

### 方案 D: 简化版 Prompt Engineering

**设计**:
```typescript
// SessionStart Hook
const lastTodo = loadLastTodoState()

if (lastTodo) {
  // 不注入复杂提示，只注入简单提醒
  return `
    <!-- SYSTEM: Last session had ${lastTodo.incomplete} incomplete tasks -->
    <!-- Type 'continue' to resume or 'new' to start fresh -->
  `
}
```

**效果**:
- ✅ 极简（5 行代码）
- ✅ 高性能（< 5ms）
- ✅ 无侵入（不修改工作流）

**问题**:
- ❌ 完全依赖 AI 是否"听话"
- ❌ 无强制力

**评分**: ⭐⭐ (50%)

---

### 方案 E: 轻量级当前方案优化版

**设计思路**:
在当前方案基础上，**增加 3 个小优化**：

#### 优化 1: Stop 时更智能的判断

```typescript
// 不只看 TodoWrite，也看实际工作
Stop Event:
  const todos = extractFromTodoWrite(transcript)
  const actualWork = detectActualWork(transcript) // 新增

  // AI 说"完成"但没有工作？
  const claimedComplete = isClaimingCompletion(transcript)
  const hasRealWork = actualWork.toolsUsed.size > 0

  if (claimedComplete && !hasRealWork && todos.incomplete > 0) {
    // 高可疑：说完成但没干活
    markSuspicious()
  }
```

#### 优化 2: SessionStart 时更友好的提示

```typescript
SessionStart:
  if (hasIncomplete) {
    // 不直接注入，而是用 AskUserQuestion
    return {
      tool: 'AskUserQuestion',
      input: {
        question: `上次有 ${count} 个任务未完成，继续吗？`,
        options: [
          { label: '✅ 继续', action: 'resume' },
          { label: '🆕 新任务', action: 'new' },
          { label: '❌ 放弃', action: 'abandon' }
        ]
      }
    }
  }
```

#### 优化 3: 语音 + Tab 增强提醒

```typescript
// 复用现有 Voice Server
Stop:
  if (incomplete > 0) {
    voice.announce(`还有 ${incomplete} 个任务未完成`)
  }

// 复用现有 Tab Title
SessionStart:
  if (hasIncomplete) {
    tab.setColor('yellow') // 黄色 = 有未完成
    tab.setTitle(`待恢复: ${incomplete} 个任务`)
  }
```

**效果**:
- ✅ 保留当前方案的所有优点
- ✅ 智能检测假完成
- ✅ 多维度提醒（视觉+听觉）
- ✅ 用户主动选择

**评分**: ⭐⭐⭐⭐ (85%)

---

## 📊 三、方案对比矩阵

| 方案 | 防止假完成 | 用户体验 | 实施难度 | 性能 | 推荐度 |
|------|-------------|---------|---------|------|--------|
| **当前方案** (Stop+Start) | 70% | 60% | ⭐ 简单 | 95% | ⭐⭐⭐ |
| **A. PreToolUse 拦截** | 90% | 40% | ⭐⭐ 中等 | 90% | ⭐⭐ |
| **B. 混合方案** | 80% | 70% | ⭐⭐⭐ 复杂 | 85% | ⭐⭐⭐ |
| **C. Algorithm 检测** | 85% | 75% | ⭐⭐⭐⭐ 很复杂 | 80% | ⭐⭐⭐ |
| **D. 简化 Prompt** | 40% | 80% | ⭐ 极简 | 99% | ⭐⭐ |
| **E. 当前方案优化** | **85%** | **80%** | **⭐⭐ 中等** | **90%** | **⭐⭐⭐⭐** |

---

## 🎯 四、推荐方案

### 推荐：**方案 E（当前方案优化版）**

**理由**:

1. **平衡性最好**
   - 防止假完成：85%（比原方案 +15%）
   - 用户体验：80%（+20%）
   - 实施难度：中等（+1 星复杂度）

2. **充分利用 PAI 优势**
   - Voice Server（已有）
   - Tab Title（已有）
   - AskUserQuestion（已有工具）

3. **渐进式改进**
   - 可以分阶段实施
   - 先实现基础，再加优化

---

## 🚀 五、实施方案 E（分阶段）

### Phase 1: 基础版（2 天）

```typescript
// 1. TodoEnforcer.hook.ts
Stop → 保存状态 → 语音提醒

// 2. TodoRecovery.hook.ts
SessionStart → 注入提示
```

### Phase 2: 智能版（1 天）

```typescript
// 3. 增强检测
TodoEnforcer → 检测"假完成"可疑模式

// 4. 用户选择
TodoRecovery → 使用 AskUserQuestion
```

### Phase 3: 完整版（1 天）

```typescript
// 5. 视觉提醒
Tab Title → 黄色 + 计数

// 6. 配置化
settings.json → 可启用/禁用功能
```

---

## 📋 六、最终建议

### 6.1 不要做的

❌ **不要完全照搬 oh-my-opencode**
- PAI 无 session.idle 事件
- PAI 无 TUI Toast API
- 强行实现会过度复杂

❌ **不要 PreToolUse 阻断式**
- 过度打扰
- 用户可能误操作
- 违背 PAI 的流畅体验

### 6.2 应该做的

✅ **基于 PAI 实际能力设计**
- 用 Stop 代替 idle
- 用 Voice 代替 Toast
- 用 Tab Title 增强视觉

✅ **分阶段实施**
- 先验证核心价值（能否防止假完成？）
- 再增强体验（视觉、听觉）
- 最后完善（配置、优化）

✅ **保持简单**
- 少于 200 行代码
- 单一职责
- 失败安全

---

## ✅ 七、总结

### 当前方案效果：⭐⭐⭐ (75/100)

**优点**:
- ✅ 简单可靠
- ✅ 性能优秀
- ✅ 实施快速

**缺点**:
- ❌ 时间窗口大
- ❌ 无主动阻止
- ❌ 体验一般

### 优化方案效果：⭐⭐⭐⭐ (85/100)

**改进**:
- ✅ 智能检测假完成（+10%）
- ✅ 多维度提醒（+20% 体验）
- ✅ 用户主动选择（+10% 控制感）

**代价**:
- ⚠️ 复杂度 +1 星（但仍然简单）
- ⚠️ 多 1-2 天实施时间

### 推荐行动

**今天开始 Phase 1**（基础版），验证核心价值。

**如果效果好**，再投入 Phase 2-3（智能版 + 完整版）。

---

**生成时间**: 2026-02-13
**下次评估**: Phase 1 完成后
