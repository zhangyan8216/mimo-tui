// src/tui/CommandPalette.tsx - Ctrl+K command palette (with scroll)

import React, { useState, useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';
import type { AgentMode } from '../api/types.js';

interface Command {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  category: string;
  action: string;
}

interface CommandPaletteProps {
  theme: Theme;
  currentMode: AgentMode;
  onSelect: (action: string) => void;
  onClose: () => void;
}

const COMMANDS: Command[] = [
  { id: 'new', label: '新建会话', description: '开始新的对话', shortcut: 'Ctrl+N', category: '会话', action: 'new' },
  { id: 'save', label: '保存会话', description: '保存当前对话', category: '会话', action: 'save' },
  { id: 'list', label: '会话列表', description: '浏览已保存的会话', shortcut: 'Ctrl+R', category: '会话', action: 'list' },
  { id: 'fork', label: '分支会话', description: '创建当前会话的分支', category: '会话', action: 'fork' },
  { id: 'export', label: '导出对话', description: '导出为 Markdown 文件', category: '会话', action: 'export' },
  { id: 'rename', label: '重命名会话', description: '给当前会话起名', category: '会话', action: 'rename' },
  { id: 'retry', label: '重试', description: '重新发送上一条消息', category: '会话', action: 'retry' },
  { id: 'undo', label: '撤销', description: '撤销到上一轮对话', category: '会话', action: 'undo' },
  { id: 'search', label: '搜索对话', description: '在对话中搜索关键词', category: '会话', action: 'search' },
  { id: 'model', label: '切换模型', description: '切换 AI 模型 (pro/flash)', category: '模式', action: 'model' },
  { id: 'bookmark', label: '会话书签', description: '查看当前会话状态', category: '会话', action: 'bookmark' },
  { id: 'forget', label: '删除记忆', description: '删除指定的记忆条目', category: '工具', action: 'forget' },
  { id: 'history', label: '命令历史', description: '查看历史命令', category: '会话', action: 'history' },
  { id: 'plan', label: '切换到计划模式', description: '只读调查模式', category: '模式', action: 'mode:plan' },
  { id: 'agent', label: '切换到智能体模式', description: '交互式审批模式', category: '模式', action: 'mode:agent' },
  { id: 'yolo', label: '切换到自动模式', description: '自动批准所有操作', category: '模式', action: 'mode:yolo' },
  { id: 'clear', label: '清屏', description: '清除聊天记录', shortcut: 'Ctrl+L', category: '工具', action: 'clear' },
  { id: 'compact', label: '压缩上下文', description: '总结较早的消息', category: '工具', action: 'compact' },
  { id: 'git', label: 'Git 状态', description: '查看 Git 仓库状态', category: 'Git', action: 'git' },
  { id: 'git-pr', label: '生成 PR 描述', description: '分析分支差异生成 PR 标题和描述', category: 'Git', action: 'git pr' },
  { id: 'git-blame', label: 'Git Blame', description: '查看文件逐行修改记录', category: 'Git', action: 'git blame' },
  { id: 'git-conflict', label: '解决合并冲突', description: '分析并帮助解决合并冲突', category: 'Git', action: 'git conflict' },
  { id: 'git-compare', label: '对比分支', description: '对比当前分支与指定分支的差异', category: 'Git', action: 'git compare' },
  { id: 'git-amend', label: '修改提交', description: '修改最近一次提交', category: 'Git', action: 'git amend' },
  { id: 'git-tag', label: '创建标签', description: '创建并推送 Git 标签', category: 'Git', action: 'git tag' },
  { id: 'git-clean', label: '清理文件', description: '清理未跟踪的文件', category: 'Git', action: 'git clean' },
  { id: 'git-bisect', label: 'Git Bisect', description: '自动排查引入 bug 的提交', category: 'Git', action: 'git bisect' },
  { id: 'git-cherry-pick', label: 'Git Cherry-pick', description: '摘取特定提交', category: 'Git', action: 'git cherry-pick' },
  { id: 'git-rebase', label: 'Git Rebase', description: '交互式变基', category: 'Git', action: 'git rebase' },
  { id: 'git-hook', label: 'Git Hook', description: '设置 pre-commit 钩子', category: 'Git', action: 'git hook pre-commit' },
  { id: 'git-undo', label: 'Git Undo', description: '撤销上一次提交', category: 'Git', action: 'git undo' },
  { id: 'git-sync', label: 'Git Sync', description: '同步远程仓库 (fetch+pull+push)', category: 'Git', action: 'git sync' },
  { id: 'git-graph', label: 'Git Graph', description: '可视化提交图', category: 'Git', action: 'git graph' },
  { id: 'git-worktree-list', label: 'Git Worktree 列表', description: '列出所有工作树', category: 'Git', action: 'git worktree list' },
  { id: 'git-stash-list', label: 'Git Stash 列表', description: '列出所有 stash', category: 'Git', action: 'git stash list' },
  { id: 'git-search', label: 'Git 搜索提交', description: '搜索 Git 提交信息', category: 'Git', action: 'git search' },
  { id: 'git-recent', label: 'Git 最近修改', description: '查看最近修改的文件', category: 'Git', action: 'git recent' },
  { id: 'git-stats', label: 'Git 月度统计', description: '查看月度代码变更统计', category: 'Git', action: 'git stats' },
  { id: 'git-issue', label: '创建 GitHub Issue', description: '创建一个新的 GitHub Issue', category: 'Git', action: 'git issue' },
  { id: 'git-pr-list', label: '列出 PR', description: '列出开放的 Pull Requests', category: 'Git', action: 'git pr list' },
  { id: 'git-ci', label: 'CI 状态', description: '查看最近 CI 运行状态', category: 'Git', action: 'git ci' },
  { id: 'tree', label: '文件树', description: '显示项目文件结构', category: '工具', action: 'tree' },
  { id: 'project', label: '项目信息', description: '显示项目类型和配置', category: '工具', action: 'project' },
  { id: 'cost', label: '费用统计', description: '查看 token 用量和费用', category: '工具', action: 'cost' },
  { id: 'tokens', label: '上下文用量', description: '查看上下文窗口使用情况', category: '工具', action: 'tokens' },
  { id: 'theme', label: '切换主题', description: '切换界面主题', category: '工具', action: 'theme' },
  { id: 'config', label: '查看配置', description: '显示当前配置信息', category: '工具', action: 'config' },
  { id: 'health', label: 'API 健康检查', description: '测试 API 连接和延迟', category: '工具', action: 'health' },
  { id: 'doctor', label: '全面诊断', description: '检查配置、API、工具、缓存状态', category: '工具', action: 'doctor' },
  { id: 'debug', label: '调试信息', description: '显示系统调试信息', category: '工具', action: 'debug' },
  { id: 'debug-agents', label: '智能体状态', description: '查看子代理状态', category: '智能体', action: 'debug agents' },
  { id: 'snippet', label: '代码片段', description: '管理代码片段库', category: '工具', action: 'snippet' },
  { id: 'kb', label: '知识库', description: '管理知识库条目', category: '工具', action: 'kb' },
  { id: 'template', label: '对话模板', description: '预设提示词模板', category: '工具', action: 'template' },
  { id: 'memory', label: '记忆系统', description: '管理持久化记忆', category: '工具', action: 'mem' },
  { id: 'parallel', label: '并行任务', description: '并行执行多个独立任务', category: '智能体', action: 'parallel' },
  { id: 'pipeline', label: '管道任务', description: '顺序执行多个任务', category: '智能体', action: 'pipeline' },
  { id: 'explore', label: '代码探索', description: '只读探索项目代码', category: '智能体', action: 'explore' },
  { id: 'review', label: '代码审查', description: '审查代码质量和潜在问题', category: '智能体', action: 'review' },
  { id: 'sub', label: '后台任务', description: '在后台运行独立子代理', category: '智能体', action: 'sub' },
  { id: 'status', label: '任务状态', description: '查看后台任务状态', category: '智能体', action: 'status' },
  { id: 'kill', label: '终止所有任务', description: '停止所有运行中的智能体', category: '智能体', action: 'kill' },
  { id: 'auto', label: '自动化工作流', description: '切换自动提交/自动测试', category: '智能体', action: 'auto' },
  { id: 'help', label: '帮助', description: '键盘快捷键和命令', shortcut: 'F1', category: '工具', action: 'help' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ theme, currentMode, onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scroll, setScroll] = useState(0);
  const viewHeight = 18;

  const filtered = useMemo(() => {
    if (!query) return COMMANDS;
    const lower = query.toLowerCase();
    return COMMANDS.filter(cmd =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.description.toLowerCase().includes(lower) ||
      cmd.category.toLowerCase().includes(lower)
    );
  }, [query]);

  const maxScroll = Math.max(0, filtered.length - viewHeight);
  const clampedScroll = Math.min(scroll, maxScroll);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) {
      setSelectedIdx(prev => {
        const next = Math.max(0, prev - 1);
        if (next < clampedScroll) setScroll(next);
        return next;
      });
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(prev => {
        const next = Math.min(filtered.length - 1, prev + 1);
        if (next >= clampedScroll + viewHeight) setScroll(next - viewHeight + 1);
        return next;
      });
      return;
    }
    if (key.return && filtered.length > 0) {
      const idx = Math.min(selectedIdx, filtered.length - 1);
      onSelect(filtered[idx].action);
      return;
    }
    if (key.backspace) { setQuery(prev => prev.slice(0, -1)); setSelectedIdx(0); setScroll(0); return; }
    if (input && !key.ctrl && !key.meta) { setQuery(prev => prev + input); setSelectedIdx(0); setScroll(0); }
  });

  const visible = filtered.slice(clampedScroll, clampedScroll + viewHeight);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.tone.brand} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text color={theme.tone.brand} bold>⌘ 命令面板</Text>
        <Text color={theme.fg.meta}>{filtered.length} / {COMMANDS.length} · ↑↓滚动</Text>
      </Box>

      {/* Search input */}
      <Box borderStyle="single" borderColor={theme.fg.faint} marginY={0} paddingX={1}>
        <Text color={theme.tone.accent}>🔍 </Text>
        <Text color={query ? theme.fg.body : theme.fg.meta}>{query || '输入以筛选...'}</Text>
      </Box>

      {/* Command list — scrollable */}
      <Box flexDirection="column" marginTop={0}>
        {clampedScroll > 0 && <Text color={theme.fg.faint}>  ↑ 更多...</Text>}
        {visible.map((cmd) => {
          const realIdx = filtered.indexOf(cmd);
          const isSelected = realIdx === selectedIdx;
          return (
            <Box key={cmd.id} paddingLeft={1}>
              <Text color={isSelected ? theme.tone.brand : theme.fg.body} bold={isSelected}>
                {isSelected ? '▸ ' : '  '}
                {cmd.label}
              </Text>
              <Text color={theme.fg.sub}> - {cmd.description}</Text>
              {cmd.shortcut && (
                <Text color={theme.fg.meta}> [{cmd.shortcut}]</Text>
              )}
            </Box>
          );
        })}
        {clampedScroll + viewHeight < filtered.length && <Text color={theme.fg.faint}>  ↓ 更多...</Text>}
        {filtered.length === 0 && (
          <Text dimColor color={theme.fg.meta}>没有匹配的命令</Text>
        )}
      </Box>
    </Box>
  );
};
