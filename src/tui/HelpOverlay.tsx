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
        <Text>  <K>/rename</K>   <Text color={theme.fg.sub}>重命名会话</Text></Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor color={theme.fg.meta}>按 Esc 或 Enter 关闭...</Text>
      </Box>
    </Box>
  );
};
