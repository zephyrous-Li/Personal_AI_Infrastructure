# Todo Continuation Enforcer - 可行性评估与实施方案

**评估人**: 千千
**评估日期**: 2026-02-13
**基于**: PAI v2.5 实际架构 + oh-my-opencode 参考实现

---

## 📊 一、可行性评估

### 1.1 架构差异分析

| 维度 | oh-my-opencode | PAI v2.5 | 影响 |
|------|----------------|-----------|------|
| **Hook API** | Plugin API (`ctx.client.session.todo()`) | 独立进程 (stdin/stdout) | ⚠️ 需要适配 |
| **事件系统** | `session.idle`, `session.error` | `Stop`, `SessionStart`, `SessionEnd` | ⚠️ 无 idle 事件 |
| **TODO 获取** | 直接 API 调用 | 解析 transcript JSON | ⚠️ 需要解析 |
| **提示注入** | `ctx.client.session.promptAsync()` | SessionStart Hook stdout | ✅ 可实现 |
| **持久化** | `.opencode/sessions/` | `~/.claude/MEMORY/STATE/` | ✅ 已有目录 |

### 1.2 关键发现

**✅ 可行**：
- PAI 已有完整的 Hook 系统（6 种事件）
- Stop 事件可以检测会话结束
- SessionStart 事件可以注入恢复提示
- MEMORY/STATE/ 目录已存在，可持久化

**⚠️ 需要适配**：
- 无 `session.idle` 事件 → 使用 `Stop` 事件代替
- 无直接 TODO API → 解析 transcript 获取 TODO
- 无 Plugin API → 使用文件系统通信

**❌ 不可行**：
- 无法显示倒计时 Toast（PAI 无 TUI API）
- 无法检测 `session.error`（PAI 不暴露此事件）

### 1.3 可行性结论

**总体评估**: ✅ **高度可行**（90%）

**原因**：
1. PAI 已有 Stop 和 SessionStart 事件
2. Transcript 包含完整的工具调用记录（包括 TodoWrite）
3. 可以通过 stdout 注入提示
4. 持久化路径已存在

**限制**：
1. 只能在会话结束时检查（不是 idle 时）
2. 无倒计时 UI（只能通过日志）
3. 需要解析 transcript（性能影响 < 100ms）

---

## 🎯 二、实施方案

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      PAI Hook 系统                      │
├─────────────────────────────────────────────────────────────┤
│                                                           │
│  Stop Event ──► TodoEnforcer.hook.ts                    │
│                      │                                    │
│                      ├─► 解析 transcript                 │
│                      ├─► 检查 TodoWrite 调用           │
│                      ├─► 提取未完成 TODO              │
│                      │                                    │
│                      ├─► 有未完成？                     │
│                      │    ├─ Yes ──► 保存状态到           │
│                      │    │            MEMORY/STATE/       │
│                      │    │            todo-state.json      │
│                      │    └─ No ──► 清理状态               │
│                                                           │
│  SessionStart ──► TodoRecovery.hook.ts                  │
│                      │                                    │
│                      ├─► 读取 todo-state.json            │
│                      ├─► 有待恢复任务？                 │
│                      │    ├─ Yes ──► 注入恢复提示  (stdout)│
│                      │    └─ No ──► 正常启动            │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### **A. TodoEnforcer.hook.ts** (Stop Event)

**触发时机**: 每次 Claude 生成响应后

**职责**:
1. 读取 transcript JSON
2. 解析最后 N 条消息，查找 `TodoWrite` 调用
3. 提取未完成的 TODO
4. 持久化到 `~/.claude/MEMORY/STATE/todo-state.json`

**输入** (stdin):
```json
{
  "session_id": "abc-123",
  "transcript_path": "/path/to/transcript.jsonl",
  "hook_event_name": "Stop"
}
```

**输出** (无 stdout):
- 写入 `~/.claude/MEMORY/STATE/todo-state.json`
- 记录日志到 stderr

**状态文件格式**:
```json
{
  "session_id": "abc-123",
  "timestamp": "2026-02-13T10:30:00Z",
  "incomplete_todos": [
    {
      "id": "1",
      "content": "完成用户认证功能",
      "status": "in_progress",
      "priority": "high"
    }
  ],
  "total_todos": 5,
  "completed_count": 2,
  "cwd": "/home/zephyr/Code/PAI"
}
```

---

#### **B. TodoRecovery.hook.ts** (SessionStart Event)

**触发时机**: 新会话开始时

**职责**:
1. 检查 `~/.claude/MEMORY/STATE/todo-state.json`
2. 如果有待恢复任务，注入恢复提示
3. 清理已过期的状态

**输入** (stdin):
```json
{
  "session_id": "new-session-456",
  "transcript_path": "/path/to/transcript.jsonl",
  "hook_event_name": "SessionStart"
}
```

**输出** (stdout - 注入到上下文):
```
⚠️ 检测到上次会话有未完成任务

上次会话: 2026-02-13 10:30
进度: 2/5 完成 (40%)

未完成任务:
- [ ] [high] 完成用户认证功能
- [ ] [medium] 编写测试用例
- [ ] [low] 更新文档

💡 提示:
- 继续完成高优先级任务
- 完成后使用 TodoWrite 标记为 completed
- 不要假装完成，确保所有任务都完成

输入 'resume' 继续上次工作，或开始新任务...
```

---

### 2.3 实现细节

#### **1. Transcript 解析**

PAI 的 transcript 是 JSONL 格式，每行一个事件：

```json
{"type":"message","role":"assistant","content":"..."}
{"type":"tool_use","tool_name":"TodoWrite","tool_input":{"todos":[...]}}
{"type":"tool_result","tool_name":"TodoWrite","result":"..."}}
```

**解析逻辑**:
```typescript
// 从后往前扫描最后 50 条消息
const messages = readTranscript(transcriptPath).slice(-50)

// 查找最后一个 TodoWrite 调用
const lastTodoWrite = messages.findLast(msg =>
  msg.type === 'tool_use' && msg.tool_name === 'TodoWrite'
)

if (!lastTodoWrite) return // 没有 TODO

const todos = lastTodoWrite.tool_input.todos
const incomplete = todos.filter(t =>
  t.status !== 'completed' && t.status !== 'cancelled'
)

if (incomplete.length > 0) {
  saveState({ incomplete, total: todos.length })
}
```

#### **2. 状态管理**

**文件路径**: `~/.claude/MEMORY/STATE/todo-state.json`

**更新策略**:
- 每次 Stop 事件时覆盖写入
- SessionStart 恢复后删除
- 超过 24 小时自动过期

#### **3. 提示注入**

使用 SessionStart Hook 的 stdout 注入：

```typescript
// TodoRecovery.hook.ts
const state = loadState()
if (state && state.incomplete_todos.length > 0) {
  console.log(formatRecoveryPrompt(state))
  // 注入到 Claude 上下文
}
```

---

### 2.4 与现有 Hooks 的集成

**依赖关系**:
```
SessionStart
    ├──► StartupGreeting (先显示 banner)
    └──► TodoRecovery (再显示恢复提示) ← 新增

Stop
    └──► StopOrchestrator
            ├──► ResponseCapture
            ├──► TabState
            └──► TodoEnforcer ← 新增
```

**无冲突**:
- StartupGreeting 不写入 stdout (非 blocking)
- TodoRecovery 写入 stdout (blocking)
- 顺序：StartupGreeting → TodoRecovery → 用户看到

---

## 📋 三、实施计划

### Phase 1: MVP (2-3 天)

**目标**: 基础功能

#### Day 1: Hook 框架
- [ ] 创建 `TodoEnforcer.hook.ts`
- [ ] 创建 `TodoRecovery.hook.ts`
- [ ] 添加到 `settings.json`
- [ ] 基础测试（手动触发）

#### Day 2: 核心逻辑
- [ ] 实现 transcript 解析
- [ ] 实现 TODO 提取
- [ ] 实现状态持久化
- [ ] 单元测试

#### Day 3: 恢复机制
- [ ] 实现 SessionStart 注入
- [ ] 格式化恢复提示
- [ ] 集成测试
- [ ] 文档更新

### Phase 2: 增强 (1-2 天)

**目标**: 生产就绪

- [ ] 添加超时清理（24 小时）
- [ ] 添加配置选项（启用/禁用）
- [ ] 优化解析性能（缓存）
- [ ] 错误处理完善

### Phase 3: 可选 (后续)

**目标**: 用户体验

- [ ] 添加语音通知（"还有 X 个任务未完成"）
- [ ] 添加 Kitty tab 标记（黄色 = 有未完成）
- [ ] 集成到 Observability Server

---

## ⚡ 四、性能评估

### 4.1 性能影响

| 操作 | 预估时间 | 影响 | 优化 |
|------|-----------|------|------|
| 解析 transcript | 10-50ms | Stop 事件 | 只扫描最后 50 条 |
| 状态文件读写 | < 5ms | Stop/Start | JSON 文件很小 |
| 提示格式化 | < 1ms | SessionStart | 简单模板 |
| **总开销** | **< 60ms** | 用户无感知 | 非阻塞（Stop） |

### 4.2 可靠性

**失败模式**:
1. **Transcript 读取失败** → 降级：跳过本次检查
2. **状态写入失败** → 降级：记录日志，不阻塞
3. **解析失败** → 降级：清理旧状态，避免重复

**错误处理**:
```typescript
try {
  const todos = parseTranscript(path)
  saveState(todos)
} catch (error) {
  console.error('[TodoEnforcer] Failed:', error)
  // 不抛出异常，不阻塞会话
  process.exit(0)
}
```

---

## 🧪 五、测试策略

### 5.1 单元测试

**测试用例**:
1. ✅ 解析正常 transcript
2. ✅ 无 TODO 时不保存状态
3. ✅ 全部完成时不保存状态
4. ✅ 部分完成时正确提取
5. ✅ 状态文件读写正确
6. ✅ 过期状态自动清理

### 5.2 集成测试

**场景**:
1. **场景 1**: 创建任务 → 停止 → 新会话 → 应看到恢复提示
2. **场景 2**: 创建任务 → 全部完成 → 停止 → 新会话 → 不应看到提示
3. **场景 3**: 创建任务 → 停止 → 24 小时后 → 新会话 → 不应看到提示
4. **场景 4**: 多次停止 → 新会话 → 应显示最后一次状态

### 5.3 手动验证

```bash
# 1. 启用 Hooks
vim ~/.claude/settings.json
# 添加到 "SessionStart" 和 "Stop" 事件

# 2. 测试 Stop Hook
echo '{"session_id":"test","transcript_path":"/path/test.jsonl","hook_event_name":"Stop"}' | \
  bun ~/.claude/hooks/TodoEnforcer.hook.ts

# 3. 验证状态文件
cat ~/.claude/MEMORY/STATE/todo-state.json

# 4. 测试 SessionStart Hook
echo '{"session_id":"new","transcript_path":"/path/new.jsonl","hook_event_name":"SessionStart"}' | \
  bun ~/.claude/hooks/TodoRecovery.hook.ts
```

---

## 📊 六、成功指标

### 6.1 功能指标

| 指标 | 当前 | 目标 | 测量方式 |
|------|------|------|---------|
| **TODO 完成率** | ~60% | > 90% | 统计 completed/total |
| **任务丢失** | 每周 1+ | 0 | 检查恢复次数 |
| **假完成次数** | 每天 3+ | < 1/天 | 用户反馈 |

### 6.2 用户体验

| 指标 | 目标 | 验证方式 |
|------|------|---------|
| **恢复提示准确率** | > 95% | 手动验证 100 次 |
| **性能影响** | < 100ms | Benchmark 测试 |
| **误报率** | < 5% | 无 TODO 时显示提示的次数 |

---

## ✅ 七、风险与缓解

### 7.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **Transcript 格式变化** | 低 | 高 | 解析失败降级，日志警告 |
| **性能回归** | 低 | 中 | 限制扫描范围（50 条） |
| **状态文件冲突** | 低 | 低 | 单写多读，原子操作 |
| **Hook 顺序问题** | 低 | 中 | 文档说明依赖关系 |

### 7.2 用户体验风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **误报**（无 TODO 却提示） | 低 | 中 | 添加配置禁用 |
| **过度打扰**（频繁提示） | 中 | 中 | 添加"不再提醒"选项 |
| **提示不清晰** | 低 | 高 | 用户测试迭代文案 |

---

## 🎯 八、总结与建议

### 8.1 可行性总结

**✅ 高度可行** (90%)

**理由**:
1. PAI 已有完整 Hook 系统
2. 无需修改核心代码
3. 依赖现有功能（transcript, MEMORY/）
4. 性能影响可忽略

**限制**:
1. 无 idle 检测（只能 Stop 时检查）
2. 无倒计时 UI（只能日志提示）
3. 需要解析 transcript（但开销很小）

### 8.2 实施建议

**推荐方案**: **Phase 1 + Phase 2** (3-5 天)

**不推荐**:
- ❌ 尝试实现倒计时 Toast（PAI 无 TUI API）
- ❌ 尝试监听 `session.error`（PAI 不支持）
- ❌ 尝试实时检查（只能在 Stop 时）

**推荐**:
- ✅ 先 MVP 验证核心价值
- ✅ 逐步增强功能
- ✅ 充分测试再发布
- ✅ 文档和代码同步更新

### 8.3 下一步行动

**今天就可以开始**:

```bash
# 1. 创建分支
cd ~/Code/PAI
git checkout -b feature/todo-enforcer

# 2. 创建 Hook 文件
touch ~/.claude/hooks/TodoEnforcer.hook.ts
touch ~/.claude/hooks/TodoRecovery.hook.ts
chmod +x ~/.claude/hooks/TodoEnforcer.hook.ts
chmod +x ~/.claude/hooks/TodoRecovery.hook.ts

# 3. 开始实现
vim ~/.claude/hooks/TodoEnforcer.hook.ts
```

---

**生成时间**: 2026-02-13
**预计完成**: 2026-02-18 (5 天)
**维护人**: 千千
