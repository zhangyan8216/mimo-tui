# 🐱 Mimo TUI

基于小米 MiMo 模型的终端 AI 编程助手，类似 Claude Code。

> 通过 Anthropic 兼容 API 连接 MiMo，在终端里实现 AI 编程对话、代码编辑、工具调用。

## ✨ 核心特性

- **终端全屏 TUI** - 基于 Ink (React for CLI)，卡片式消息渲染
- **流式响应** - 实时流式输出，30fps 防闪烁，显示推理过程
- **8 个内置工具** - 读/写/编辑文件、Shell 命令、Glob、Grep、Web、Todo
- **AI 记忆系统** - 跨会话记住用户偏好，自动注入系统提示词
- **5 个工作流** - 代码审查/测试生成/重构/Git 提交/调试
- **12 个对话模板** - 预设提示词一键使用
- **上下文压缩** - 对话过长时自动总结旧消息
- **5 种主题** - Graphite/Whale/Matrix/Dracula/Solarized

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/YOUR_USERNAME/mimo-tui.git
cd mimo-tui

# 安装依赖
npm install

# 配置 API 密钥
mkdir -p ~/.mimo
cat > ~/.mimo/config.toml << 'EOF'
[provider]
api_key = "your-mimo-api-key"
base_url = "https://token-plan-cn.xiaomimimo.com/anthropic"
model = "mimo-v2.5-pro"

[agent]
mode = "agent"
max_iterations = 32
thinking_enabled = true
reasoning_effort = "medium"

[ui]
theme = "default"
EOF

# 启动
npm start
```

## ⌨️ 快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|--------|------|--------|------|
| `Ctrl+K` | 命令面板 | `Ctrl+R` | 会话列表 |
| `Ctrl+N` | 新建会话 | `Ctrl+L` | 清屏 |
| `Ctrl+Z` | 撤销 | `Ctrl+C` | 取消/退出 |
| `Alt+1/2/3` | 切换模式 | `?` | 帮助 |

## 📝 斜杠命令

### 会话管理
```
/new          新建会话        /retry        重试上一条
/undo         撤销上一轮      /export       导出 Markdown
/rename <名>  重命名会话      /search <词>  搜索对话
/history      命令历史        /compact      压缩上下文
```

### Git & 项目
```
/git status   Git 状态        /git diff     Git 差异
/git log      提交记录        /tree         文件树
/project      项目信息        /changes      文件变更
```

### 模型 & 配置
```
/mode <模式>  切换模式        /model <名>   切换模型
/theme <名>   切换主题        /config       查看配置
/health       API 健康检查    /debug        调试信息
```

### 费用 & 统计
```
/cost         费用统计(含累计) /tokens       上下文用量
/stats        会话统计        /snip         代码片段库
```

### AI 能力
```
/tpl          对话模板(12个)  /wf           工作流(5个)
/mem <k> <v>  记住信息        /forget <k>   忘记信息
/suggest      智能建议        /chain        命令链
```

## 🏗️ 项目结构

```
src/
├── index.tsx              # 入口
├── config.ts              # 配置 (~/.mimo/config.toml)
├── api/
│   ├── client.ts          # Anthropic API 客户端 (带重试/容错)
│   └── types.ts           # 类型定义
├── tools/                 # 8 个内置工具
├── tui/                   # Ink/React UI 组件
├── agent/
│   ├── loop.ts            # Agent 主循环
│   ├── modes.ts           # Plan/Agent/YOLO 模式
│   ├── compact.ts         # 上下文压缩
│   └── sub-agent.ts       # 子代理
├── session/               # SQLite 会话持久化
├── mcp/                   # MCP 协议客户端
├── skills/                # 技能系统
└── utils/
    ├── git.ts             # Git 集成
    ├── project.ts         # 项目感知
    ├── memory.ts          # AI 记忆
    ├── workflow.ts         # 工作流引擎
    ├── templates.ts       # 对话模板
    ├── snippets.ts        # 代码片段
    ├── cost.ts            # 成本追踪
    ├── history.ts         # 命令历史
    ├── health.ts          # API 健康检查
    ├── export.ts          # 对话导出
    ├── notify.ts          # 系统通知
    ├── filetree.ts        # 文件树
    ├── watcher.ts         # 文件监控
    ├── suggestions.ts     # 智能建议
    ├── sandbox.ts         # 文件沙箱
    ├── tokens.ts          # Token 计算
    └── logger.ts          # 日志
```

## ⚙️ 配置

`~/.mimo/config.toml`:

```toml
[provider]
api_key = "tp-your-key"
base_url = "https://token-plan-cn.xiaomimimo.com/anthropic"
model = "mimo-v2.5-pro"

[agent]
mode = "agent"              # plan | agent | yolo
max_iterations = 32
auto_approve_reads = true
thinking_enabled = true
reasoning_effort = "medium" # low | medium | high

[ui]
theme = "default"           # default | whale | matrix | dracula | solarized
show_thinking = true
show_tokens = true
```

## 🔧 MiMo 容错处理

针对 MiMo 模型已知问题的自动处理：

| 问题 | 处理方案 |
|------|----------|
| 无限重复循环 (Issue #59) | 自动检测重复文本，截断并提示 |
| 429 限流 (Issue #55) | 指数退避自动重试 |
| tool_use 参数序列化 (Issue #57) | 双重解析修复 |
| 系统消息位置 (Issue #54) | system 只放顶层字段 |
| 流式断连 | fetchWithRetry 自动重连 |

## 📄 License

MIT
