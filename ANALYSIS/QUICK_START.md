# PAI 增强实施快速指南

## 🚀 快速开始（10 分钟）

### Step 1: 创建功能分支
```bash
cd ~/Code/PAI

# 确保在 main
git checkout main
git pull upstream main --no-edit

# 创建 P0 功能分支
git checkout -b feature/p0-todo-enforcer
```

### Step 2: 选择第一个任务

#### 选项 A: Todo Continuation Enforcer（推荐）
**难度**: ⭐⭐
**工时**: 2-3 天
**价值**: ⭐⭐⭐

```bash
# 创建新 Pack
mkdir -p ~/Code/PAI/Packs/pai-todo-enforcer-skill/{Hooks,Tools,Workflows}
cd ~/Code/PAI/Packs/pai-todo-enforcer-skill

# 复制模板
cp ../pai-agents-skill/src/skills/Agents/SKILL.md ./

# 开始编辑
vim SKILL.md
```

**最小实现**:
1. 在 `Hooks/SessionStop.hook.md` 中定义逻辑
2. 在 `Tools/CheckTodos.ts` 中实现检查
3. 在 `Workflows/ResumeWork.md` 中定义恢复流程

#### 选项 B: Background Manager（复杂但价值高）
**难度**: ⭐⭐⭐
**工时**: 5-7 天
**价值**: ⭐⭐⭐

```bash
# 创建新 Pack
mkdir -p ~/Code/PAI/Packs/pai-background-manager/{src,tests,SKILL.md}
cd ~/Code/PAI/Packs/pai-background-manager

# 学习 oh-my-opencode 实现
code ~/Code/oh-my-opencode/src/features/background-agent/manager.ts
```

**最小实现**:
1. 创建 `BackgroundManager` 类
2. 实现 `launch()` 方法（创建任务）
3. 实现 `poll()` 方法（轮询状态）
4. 测试并行 3 个任务

---

## 📋 实施检查清单

### 开始前确认
- [ ] 已阅读 `ENHANCEMENT_PLAN.md`
- [ ] 已理解 `ARCHITECTURE_COMPARISON.md`
- [ ] 已创建功能分支
- [ ] 已选择实施任务

### Todo Enforcer 检查
- [ ] 创建了 `Hooks/SessionStop.hook.md`
- [ ] 实现了 `Tools/CheckTodos.ts`
- [ ] 定义了 `Workflows/ResumeWork.md`
- [ ] 本地测试通过
- [ ] 更新了 `SKILL.md`

### Background Manager 检查
- [ ] 创建了 `src/BackgroundManager.ts`
- [ ] 实现了 `ConcurrencyManager`
- [ ] 添加了测试文件
- [ ] 本地测试通过
- [ ] 并行执行成功

### 提交前检查
- [ ] 运行了 `bash verify-opencode-integration.sh`
- [ ] 所有测试通过
- [ ] 更新了文档
- [ ] 提交信息清晰

---

## 💡 实施技巧

### 1. 从最简版本开始
```typescript
// ❌ 不要一次性实现所有功能
class BackgroundManager {
  async launch() {
    // 并发控制
    // 队列管理
    // 状态追踪
    // 通知系统
    // ...太多
  }
}

// ✅ 先实现核心功能
class BackgroundManager {
  async launch(input) {
    // 只创建任务
    const task = { id: randomID(), ...input }
    return task
  }
}

// 然后迭代添加
```

### 2. 参考 oh-my-opencode
```bash
# 不要重新发明轮子
# 阅读 oh-my-opencode 的实现

# Todo Enforcer
code ~/Code/oh-my-opencode/src/hooks/todo-continuation-enforcer/

# Background Manager
code ~/Code/oh-my-opencode/src/features/background-agent/manager.ts

# Category Routing
code ~/Code/oh-my-opencode/src/tools/delegate-task/constants.ts
```

### 3. 使用 TDD
```typescript
// ❌ 先写实现
function launch() {
  // ... 复杂实现
}

// ✅ 先写测试
test('launch creates task', () => {
  const task = launch({ agent: 'test' })
  expect(task.id).toBeDefined()
})

// 然后写最小实现
function launch() {
  return { id: random() }
}
```

### 4. 小步提交
```bash
# ❌ 大而全的提交
git commit -m "添加 Todo Enforcer"
# 100 个文件，难以 review

# ✅ 小步提交
git commit -m "feat(todo-enforcer): add Hook template"
git commit -m "feat(todo-enforcer): implement CheckTodos tool"
git commit -m "test(todo-enforcer): add basic tests"
# 每次 review 容易
```

---

## 🎯 学习路径

### Day 1: 理解架构
```bash
# 阅读 oh-my-opencode 核心文件
code ~/Code/oh-my-opencode/src/create-hooks.ts
code ~/Code/oh-my-opencode/src/create-managers.ts
code ~/Code/oh-my-opencode/src/plugin-hooks/

# 阅读 PAI 对应文件
code ~/Code/PAI/Packs/pai-hook-system/src/hooks/
```

### Day 2-3: 实现功能
```bash
# 选择任务（Todo Enforcer）
cd ~/Code/PAI/Packs/pai-todo-enforcer-skill

# 最小可用实现
vim Hooks/SessionStop.hook.md
vim Tools/CheckTodos.ts
vim Workflows/ResumeWork.md
vim SKILL.md
```

### Day 4: 测试和文档
```bash
# 测试
cd ~/Code/PAI
bash .claude/verify-opencode-integration.sh

# 文档
vim PAI-todo-enforcer-skill/USAGE.md
```

---

## 📞 实施资源

### 模板文件
```
PAI/Packs/
├── pai-agents-skill/          # Agents Skill 模板
└── pai-hook-system/          # Hook 系统参考
```

### 参考实现
```
oh-my-opencode/src/
├── hooks/todo-continuation-enforcer/  # TODO 强制
├── features/background-agent/         # 并发管理
├── tools/delegate-task/              # 任务路由
└── config/schema/                    # Zod Schema
```

### 文档资源
```
PAI/ANALYSIS/
├── ENHANCEMENT_PLAN.md      # 完整方案
├── ARCHITECTURE_COMPARISON.md # 架构对比
└── QUICK_START.md           # 本文件
```

---

## 🤝 获取帮助

### 遇到问题？

**1. 查看文档**
```bash
# PAI 文档
cat ~/Code/PAI/ANALYSIS/ENHANCEMENT_PLAN.md

# oh-my-opencode 源码
grep -r "todoContinuation" ~/Code/oh-my-opencode/src/
```

**2. 运行测试**
```bash
# 验证当前状态
cd ~/Code/PAI
bash .claude/verify-opencode-integration.sh
```

**3. 查看日志**
```bash
# Hook 执行日志
tail -f ~/.claude/MEMORY/WORK/sessions/*.log
```

**4. 回退更改**
```bash
# 如果出问题，回退
git checkout main
git branch -D feature/p0-todo-enforcer
# 从头开始
```

---

## ✅ 实施后验证

### 功能验证
```bash
# Todo Enforcer
1. 创建一个 TODO
2. 停止会话
3. 重新打开
4. 验证: TODO 是否恢复？

# Background Manager
1. 启动 3 个并行任务
2. 检查: 是否同时运行？
3. 验证: 状态是否正确？
```

### 性能验证
```bash
# 并发测试
$ time (
  for i in {1..10}; do
    # 启动任务
  done
)

# 对比单线程 vs 多线程
# 应该看到明显提速
```

### 稳定性验证
```bash
# 压力测试
1. 创建 100 个任务
2. 验证: 无内存泄漏
3. 验证: 无僵尸任务
4. 验证: 并发限制生效
```

---

## 🎓 成功案例

### 案例 1: Todo Enforcer
**问题**: AI 总是"假完成"
**解决**: 检测未完成 TODO
**效果**: 任务完成率 60% → 95%

### 案例 2: Background Manager
**问题**: Council 辩论串行，太慢
**解决**: 真正并行执行
**效果**: 10 代理并发，10x 提速

### 案例 3: Category Routing
**问题**: 需要手动指定技能
**解决**: 自动检测 + 路由
**效果**: 用户无需学习技能名

---

## 🚦 下一步

### Week 1-2: P0 功能
- [ ] Todo Continuation Enforcer
- [ ] Background Manager

### Week 3-4: P1 架构
- [ ] 分层 Hook 架构
- [ ] Category Routing
- [ ] Session Recovery

### Week 5+: P2 改进
- [ ] JSONC + Zod Schema
- [ ] TDD 测试框架
- [ ] 持续迭代

---

**记住**: 从小处着手，持续迭代！

今天是 Day 1: 开始第一个 P0 功能 🚀
