# PAI Fork 指南（SSH 流程）

**GitHub 用户**：zephyrous-Li
**配置方式**：SSH
**原仓库**：danielmiessler/PAI

---

## ✅ SSH 配置验证

**你的 SSH 密钥**：`~/.ssh/id_ed25519`
**GitHub 连接**：✅ 已验证（Hi zephyrous-Li!）

---

## 🎯 Fork 流程（4 步）

### 步骤 1：在 GitHub 上 Fork（网页操作）

1. **打开浏览器**，访问：
   ```
   https://github.com/danielmiessler/PAI
   ```

2. **点击 Fork 按钮**（右上角）

3. **等待创建完成**（几秒钟）

   Fork 后地址：
   ```
   https://github.com/zephyrous-Li/PAI
   ```

---

### 步骤 2：配置本地 Remotes

**重要**：先在网页上完成 Fork，然后执行以下命令！

```bash
cd ~/Code/PAI

# 1. 重命名原 remote 为 upstream
git remote rename origin upstream

# 2. 验证 upstream
git remote -v
# 应该看到：upstream	git@github.com:danielmiessler/PAI.git

# 3. 添加你的 fork（SSH URL）
git remote add origin git@github.com:zephyrous-Li/PAI.git

# 4. 验证配置
git remote -v
```

**预期输出**：
```
upstream	git@github.com:danielmiessler/PAI.git (fetch)
upstream	git@github.com:danielmiessler/PAI.git (push)
origin	git@github.com:zephyrous-Li/PAI.git (fetch)
origin	git@github.com:zephyrous-Li/PAI.git (push)
```

---

### 步骤 3：同步上游代码（可选）

```bash
cd ~/Code/PAI

# 获取上游更新
git fetch upstream

# 查看差异
git log HEAD..upstream/main --oneline

# 如果有更新，合并
git merge upstream/main --no-edit

# 推送到你的 fork
git push origin main
```

---

### 步骤 4：创建功能分支

```bash
# 创建你的第一个功能分支
git checkout -b feature/enhancement-plan

# 或者其他命名
git checkout -b feature/todo-enforcer
git checkout -b feature/category-routing
```

---

## 🔄 Remote 结构（Fork 模式）

```
upstream（原仓库） ← 拉取更新
    ↓
  （定期同步）
    ↓
你的本地 main
    ↓
origin（你的 fork） ← 推送修改
    ↓
  feature/* 分支
    ↓
  你的修改
```

---

## 📊 SSH vs HTTPS

| 方式 | URL 格式 | 优点 |
|------|----------|------|
| **SSH** | `git@github.com:user/repo.git` | ✅ 更安全<br>✅ 无需密码<br>✅ 更快 |
| **HTTPS** | `https://github.com/user/repo.git` | ✅ 防火墙友好 |

**你已配置 SSH**，这是最佳方式！

---

## 🚀 日常开发工作流

### 开始新功能

```bash
cd ~/Code/PAI

# 1. 确保在 main 且已同步
git checkout main
git pull upstream main --no-edit

# 2. 创建功能分支
git checkout -b feature/my-awesome-feature

# 3. 修改代码
# ... 编辑文件 ...

# 4. 提交
git add .
git commit -m "feat: 添加我的功能"

# 5. 推送到你的 fork
git push origin feature/my-awesome-feature
```

### 定期同步上游

```bash
cd ~/Code/PAI

# 快捷方式
git pull upstream main --no-edit
git push origin main
```

或创建同步脚本：

```bash
# ~/bin/sync-pai.sh
#!/bin/bash
cd ~/Code/PAI
echo "🔄 同步上游更新..."
git fetch upstream
git checkout main
git merge upstream/main --no-edit
git push origin main
echo "✅ 同步完成！"
```

使用：
```bash
chmod +x ~/bin/sync-pai.sh
~/bin/sync-pai.sh
```

---

## 🎯 分支命名规范

| 类型 | 前缀 | 示例 |
|------|------|------|
| 功能 | `feature/` | `feature/todo-enforcer` |
| 修复 | `bugfix/` | `bugfix/config-validation` |
| 重构 | `refactor/` | `refactor/hook-system` |
| 文档 | `docs/` | `docs/fork-guide` |
| 测试 | `test/` | `test/enforcer` |

---

## 📝 提交信息规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型 (type)**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

**示例**：
```
feat(todo): 添加任务完成强制器

- 实现 session state 追踪
- 添加 countdown timer
- 自动恢复未完成任务

Closes #1
```

---

## 🚫 常见错误

### ❌ 错误 1：忘记先 Fork

```bash
# 如果你直接尝试推送，会失败
git push origin main
# fatal: repository 'git@github.com:zephyrous-Li/PAI.git' not found

# 解决：先在 GitHub 网页上 Fork 仓库
```

### ❌ 错误 2：推送到 upstream

```bash
# 不要这样做
git push upstream main  # ❌ 权限拒绝

# 应该推送到 origin
git push origin main  # ✅
```

### ❌ 错误 3：在 main 上直接开发

```bash
# 不要这样做
git checkout main
# ... 修改 ...  # ❌ main 应保持干净

# 应该这样做
git checkout -b feature/my-feature
# ... 修改 ...  # ✅ 功能分支
git checkout main
git merge feature/my-feature
```

---

## ✅ 验证配置成功

```bash
# 1. 检查 remotes
git remote -v
# 应该看到 upstream 和 origin

# 2. 检查 SSH 连接
ssh -T git@github.com
# 应该看到：Hi zephyrous-Li! ...

# 3. 测试推送到 origin
git push origin main
# 第一次可能需要验证
```

---

## 🌐 Fork 后的 URL

| 类型 | URL |
|------|-----|
| **原仓库** | https://github.com/danielmiessler/PAI |
| **你的 Fork** | https://github.com/zephyrous-Li/PAI |
| **SSH URL** | git@github.com:zephyrous-Li/PAI.git |

---

## 💡 下一步

1. **在浏览器中 Fork 仓库**
   - 访问：https://github.com/danielmiessler/PAI
   - 点击 "Fork" 按钮

2. **回来告诉我"完成"**
   - 我会帮你配置 remotes

3. **创建第一个功能分支**
   - `git checkout -b feature/my-first-change`

4. **开始修改！**
   - 自由开发，不影响上游

---

**创建日期**：2026-02-13
**用户**：zephyrous-Li
**配置方式**：SSH
**状态**：等待 Fork 操作
