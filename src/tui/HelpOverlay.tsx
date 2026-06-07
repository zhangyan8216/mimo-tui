// src/tui/HelpOverlay.tsx - 帮助界面

import React from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';

interface HelpOverlayProps {
  theme: Theme;
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ theme, onClose }) => {
  useInput((_input, key) => {
    if (key.escape || key.return) onClose();
  });

  const K = ({ children }: { children: React.ReactNode }) => (
    <Text color={theme.tone.brand} bold>{children}</Text>
  );

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.tone.brand} paddingX={1}>
      <Text color={theme.tone.brand} bold>❓ 帮助</Text>
      <Box marginTop={1} flexDirection="column" gap={1}>
        <Text color={theme.tone.accent} bold>通用</Text>
        <Text>  <K>Ctrl+C</K>  <Text color={theme.fg.sub}>取消 / 退出</Text></Text>
        <Text>  <K>Ctrl+K</K>  <Text color={theme.fg.sub}>命令面板</Text></Text>
        <Text>  <K>Ctrl+R</K>  <Text color={theme.fg.sub}>会话列表</Text></Text>
        <Text>  <K>Ctrl+N</K>  <Text color={theme.fg.sub}>新建会话</Text></Text>
        <Text>  <K>Ctrl+L</K>  <Text color={theme.fg.sub}>清屏</Text></Text>
        <Text>  <K>Ctrl+Z</K>  <Text color={theme.fg.sub}>撤销上一轮</Text></Text>
        <Text>  <K>Alt+1/2/3</K> <Text color={theme.fg.sub}>切换模式 (计划/智能体/自动)</Text></Text>
        <Text>  <K>?</K>        <Text color={theme.fg.sub}>帮助</Text></Text>

        <Text color={theme.tone.accent} bold>输入</Text>
        <Text>  <K>Enter</K>        <Text color={theme.fg.sub}>发送消息</Text></Text>
        <Text>  <K>Shift+Enter</K>  <Text color={theme.fg.sub}>换行</Text></Text>
        <Text>  <K>Tab</K>          <Text color={theme.fg.sub}>补全斜杠命令</Text></Text>
        <Text>  <K>↑/↓</K>          <Text color={theme.fg.sub}>历史记录</Text></Text>
        <Text>  <K>Ctrl+U</K>       <Text color={theme.fg.sub}>清空当前行</Text></Text>
        <Text>  <K>Ctrl+A/E</K>     <Text color={theme.fg.sub}>行首/行尾</Text></Text>

        <Text color={theme.tone.accent} bold>审批</Text>
        <Text>  <K>Y</K>  <Text color={theme.fg.sub}>批准一次</Text>  <K>A</K>  <Text color={theme.fg.sub}>始终批准</Text>  <K>N</K>  <Text color={theme.fg.sub}>拒绝</Text></Text>

        <Text color={theme.tone.accent} bold>斜杠命令</Text>
        <Text>  <K>/new</K>      <Text color={theme.fg.sub}>新建会话</Text>    <K>/retry</K>    <Text color={theme.fg.sub}>重试上一条</Text></Text>
        <Text>  <K>/undo</K>     <Text color={theme.fg.sub}>撤销上一轮</Text>  <K>/export</K>   <Text color={theme.fg.sub}>导出对话</Text></Text>
        <Text>  <K>/mode</K>     <Text color={theme.fg.sub}>切换模式</Text>    <K>/model</K>    <Text color={theme.fg.sub}>切换模型</Text></Text>
        <Text>  <K>/git</K>      <Text color={theme.fg.sub}>Git 状态</Text>    <K>/tree</K>     <Text color={theme.fg.sub}>文件树</Text></Text>
        <Text>  <K>/project</K>  <Text color={theme.fg.sub}>项目信息</Text>    <K>/cost</K>     <Text color={theme.fg.sub}>费用统计</Text></Text>
        <Text>  <K>/theme</K>    <Text color={theme.fg.sub}>切换主题</Text>    <K>/compact</K>  <Text color={theme.fg.sub}>压缩上下文</Text></Text>
        <Text>  <K>/clear</K>    <Text color={theme.fg.sub}>清屏</Text>        <K>/debug</K>    <Text color={theme.fg.sub}>调试信息</Text></Text>
        <Text>  <K>/health</K>   <Text color={theme.fg.sub}>API 检查</Text>    <K>/history</K>  <Text color={theme.fg.sub}>命令历史</Text></Text>
        <Text>  <K>/search</K>   <Text color={theme.fg.sub}>搜索对话</Text>    <K>/tokens</K>   <Text color={theme.fg.sub}>上下文用量</Text></Text>
        <Text>  <K>/rename</K>   <Text color={theme.fg.sub}>重命名会话</Text>  <K>/config</K>   <Text color={theme.fg.sub}>查看配置</Text></Text>
        <Text>  <K>/model</K>    <Text color={theme.fg.sub}>切换模型</Text>    <K>/cd</K>      <Text color={theme.fg.sub}>切换目录</Text></Text>
        <Text>  <K>/bookmark</K> <Text color={theme.fg.sub}>会话书签</Text>    <K>/doctor</K>   <Text color={theme.fg.sub}>全面诊断</Text></Text>
        <Text>  <K>/fix</K>      <Text color={theme.fg.sub}>自动修复</Text>    <K>/tips</K>    <Text color={theme.fg.sub}>费用优化</Text></Text>
        <Text>  <K>/sub</K>      <Text color={theme.fg.sub}>后台任务</Text>    <K>/forget</K>   <Text color={theme.fg.sub}>删除记忆</Text></Text>
        <Text>  <K>/wf</K>       <Text color={theme.fg.sub}>工作流</Text>      <K>/mem</K>      <Text color={theme.fg.sub}>记忆系统</Text></Text>
        <Text>  <K>/template</K> <Text color={theme.fg.sub}>对话模板</Text>    <K>/snippet</K>  <Text color={theme.fg.sub}>代码片段</Text></Text>
        <Text>  <K>/stats</K>    <Text color={theme.fg.sub}>会话统计</Text>    <K>/suggest</K>  <Text color={theme.fg.sub}>智能建议</Text></Text>
        <Text>  <K>/watch</K>    <Text color={theme.fg.sub}>文件监控</Text>    <K>/chain</K>    <Text color={theme.fg.sub}>命令链</Text></Text>
        <Text>  <K>/think</K>    <Text color={theme.fg.sub}>推理深度</Text>    <K>/context</K>  <Text color={theme.fg.sub}>上下文详情</Text></Text>
        <Text>  <K>/improve</K>  <Text color={theme.fg.sub}>代码质量分析</Text>  <K>/batch</K>  <Text color={theme.fg.sub}>批量执行命令</Text></Text>
        <Text>  <K>/parallel</K> <Text color={theme.fg.sub}>并行任务</Text>    <K>/explore</K>  <Text color={theme.fg.sub}>代码探索</Text></Text>
        <Text>  <K>/review</K>  <Text color={theme.fg.sub}>代码审查</Text>    <K>/status</K>   <Text color={theme.fg.sub}>任务状态</Text></Text>
        <Text>  <K>/auto</K>    <Text color={theme.fg.sub}>自动化工作流</Text>  <K>/pipeline</K> <Text color={theme.fg.sub}>管道任务</Text></Text>
        <Text>  <K>/kill</K>    <Text color={theme.fg.sub}>终止所有任务</Text>  <K>/clean</K>    <Text color={theme.fg.sub}>清理数据</Text></Text>
        <Text>  <K>/metrics</K> <Text color={theme.fg.sub}>会话指标</Text>    <K>/kb</K>       <Text color={theme.fg.sub}>知识库管理</Text></Text>
        <Text>  <K>/debug agents</K> <Text color={theme.fg.sub}>智能体状态</Text>  <K>/config reset</K> <Text color={theme.fg.sub}>重置配置</Text></Text>

        <Text color={theme.tone.accent} bold>Git 子命令</Text>
        <Text>  <K>/git pr</K>               <Text color={theme.fg.sub}>生成 PR 标题和描述</Text></Text>
        <Text>  <K>/git blame &lt;file&gt;</K>     <Text color={theme.fg.sub}>查看文件逐行修改记录</Text></Text>
        <Text>  <K>/git conflict</K>         <Text color={theme.fg.sub}>帮助解决合并冲突</Text></Text>
        <Text>  <K>/git compare &lt;branch&gt;</K> <Text color={theme.fg.sub}>对比分支差异</Text></Text>
        <Text>  <K>/git amend</K>            <Text color={theme.fg.sub}>修改最近一次提交</Text></Text>
        <Text>  <K>/git tag &lt;name&gt;</K>       <Text color={theme.fg.sub}>创建并推送标签</Text></Text>
        <Text>  <K>/git clean</K>            <Text color={theme.fg.sub}>清理未跟踪文件</Text></Text>

        <Text color={theme.tone.accent} bold>Git 高级</Text>
        <Text>  <K>/git bisect &lt;good&gt; &lt;bad&gt;</K> <Text color={theme.fg.sub}>自动排查引入 bug 的提交</Text></Text>
        <Text>  <K>/git cherry-pick &lt;commit&gt;</K> <Text color={theme.fg.sub}>摘取特定提交</Text></Text>
        <Text>  <K>/git rebase &lt;branch&gt;</K>    <Text color={theme.fg.sub}>交互式变基</Text></Text>
        <Text>  <K>/git hook pre-commit</K>    <Text color={theme.fg.sub}>设置 pre-commit 钩子</Text></Text>
        <Text>  <K>/git undo</K>               <Text color={theme.fg.sub}>撤销上一次提交</Text></Text>
        <Text>  <K>/git sync</K>               <Text color={theme.fg.sub}>同步远程仓库</Text></Text>
        <Text>  <K>/git graph</K>              <Text color={theme.fg.sub}>可视化提交图</Text></Text>

        <Text color={theme.tone.accent} bold>Git Worktree / Stash</Text>
        <Text>  <K>/git worktree list</K>          <Text color={theme.fg.sub}>列出所有工作树</Text></Text>
        <Text>  <K>/git worktree add &lt;branch&gt;</K>  <Text color={theme.fg.sub}>创建新工作树</Text></Text>
        <Text>  <K>/git worktree remove &lt;name&gt;</K> <Text color={theme.fg.sub}>移除工作树</Text></Text>
        <Text>  <K>/git stash list</K>             <Text color={theme.fg.sub}>列出所有 stash</Text></Text>
        <Text>  <K>/git stash apply [n]</K>        <Text color={theme.fg.sub}>应用指定 stash</Text></Text>
        <Text>  <K>/git stash drop [n]</K>         <Text color={theme.fg.sub}>删除指定 stash</Text></Text>

        <Text color={theme.tone.accent} bold>Git 工具</Text>
        <Text>  <K>/git search &lt;query&gt;</K>    <Text color={theme.fg.sub}>搜索提交信息</Text></Text>
        <Text>  <K>/git recent</K>            <Text color={theme.fg.sub}>最近修改的文件</Text></Text>
        <Text>  <K>/git contributors</K>     <Text color={theme.fg.sub}>贡献者列表</Text></Text>
        <Text>  <K>/git release &lt;version&gt;</K> <Text color={theme.fg.sub}>创建发布版本 (tag+CHANGELOG)</Text></Text>
        <Text>  <K>/git wip</K>               <Text color={theme.fg.sub}>快速 WIP 提交</Text></Text>

        <Text color={theme.tone.accent} bold>GitHub 集成</Text>
        <Text>  <K>/git issue &lt;title&gt;</K>     <Text color={theme.fg.sub}>创建 GitHub Issue</Text></Text>
        <Text>  <K>/git pr list</K>           <Text color={theme.fg.sub}>列出开放的 PR</Text></Text>
        <Text>  <K>/git pr view [n]</K>       <Text color={theme.fg.sub}>查看 PR 详情</Text></Text>
        <Text>  <K>/git pr merge [n]</K>      <Text color={theme.fg.sub}>合并 PR (squash)</Text></Text>
        <Text>  <K>/git ci</K>                <Text color={theme.fg.sub}>查看 CI 状态</Text></Text>
        <Text>  <K>/git ci logs</K>           <Text color={theme.fg.sub}>查看最新 CI 日志</Text></Text>

        <Text color={theme.tone.accent} bold>Git 统计</Text>
        <Text>  <K>/git stats</K>             <Text color={theme.fg.sub}>月度 Git 统计</Text></Text>
        <Text>  <K>/git authors</K>           <Text color={theme.fg.sub}>所有作者及提交次数</Text></Text>
        <Text>  <K>/git churn</K>             <Text color={theme.fg.sub}>文件变更频率排名</Text></Text>
        <Text>  <K>/git timeline &lt;file&gt;</K>   <Text color={theme.fg.sub}>文件提交时间线</Text></Text>

        <Text color={theme.tone.accent} bold>AI 工具</Text>
        <Text>  <K>code_review</K> <Text color={theme.fg.sub}>代码审查 (diff/file/pr/staged)</Text></Text>

        <Text color={theme.tone.accent} bold>插件</Text>
        <Text color={theme.fg.sub}>📁 插件放在 .mimo/plugins/ 目录</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor color={theme.fg.meta}>按 Esc 或 Enter 关闭...</Text>
      </Box>
    </Box>
  );
};
