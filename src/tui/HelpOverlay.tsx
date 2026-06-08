// src/tui/HelpOverlay.tsx - 帮助界面 (可滚动)

import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';

interface HelpOverlayProps {
  theme: Theme;
  onClose: () => void;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({ theme, onClose }) => {
  const [scroll, setScroll] = useState(0);
  const viewHeight = 28; // visible lines

  useInput((_input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setScroll(s => Math.max(0, s - 1)); return; }
    if (key.downArrow) { setScroll(s => s + 1); return; }
    if (key.pageUp) { setScroll(s => Math.max(0, s - viewHeight)); return; }
    if (key.pageDown) { setScroll(s => s + viewHeight); return; }
  });

  const K = ({ children }: { children: React.ReactNode }) => (
    <Text color={theme.tone.brand} bold>{children}</Text>
  );

  const lines: React.ReactNode[] = [
    <Text key="h1" color={theme.tone.accent} bold>通用</Text>,
    <Text key="g1">  <K>Ctrl+C</K>  取消/退出  <K>Ctrl+K</K>  命令面板  <K>Ctrl+R</K>  会话列表</Text>,
    <Text key="g2">  <K>Ctrl+N</K>  新建会话  <K>Ctrl+L</K>  清屏  <K>Ctrl+Z</K>  撤销</Text>,
    <Text key="g3">  <K>Alt+1/2/3</K> 切换模式 (计划/智能体/自动)  <K>F1</K> 帮助</Text>,

    <Text key="h2" color={theme.tone.accent} bold>输入</Text>,
    <Text key="i1">  <K>Enter</K> 发送  <K>Shift+Enter</K> 换行  <K>Tab</K> 补全  <K>↑↓</K> 历史</Text>,
    <Text key="i2">  <K>Ctrl+W</K> 删词  <K>Ctrl+U</K> 清行  <K>Ctrl+A/E</K> 行首/行尾</Text>,
    <Text key="i3">  <K>Ctrl+←/→</K> 词级移动  <K>←/→</K> 字符移动</Text>,

    <Text key="h3" color={theme.tone.accent} bold>审批</Text>,
    <Text key="a1">  <K>[Y]</K> 批准  <K>[A]</K> 始终允许  <K>[N]</K> 拒绝</Text>,

    <Text key="h4" color={theme.tone.accent} bold>会话命令</Text>,
    <Text key="s1">  <K>/new</K> 新建  <K>/retry</K> 重试  <K>/undo</K> 撤销  <K>/export</K> 导出</Text>,
    <Text key="s2">  <K>/mode</K> 模式  <K>/model</K> 模型  <K>/clear</K> 清屏  <K>/compact</K> 压缩</Text>,
    <Text key="s3">  <K>/search</K> 搜索  <K>/rename</K> 重命名  <K>/history</K> 历史</Text>,

    <Text key="h5" color={theme.tone.accent} bold>工具命令</Text>,
    <Text key="t1">  <K>/tree</K> 文件树  <K>/project</K> 项目信息  <K>/cost</K> 费用</Text>,
    <Text key="t2">  <K>/theme</K> 主题  <K>/config</K> 配置  <K>/debug</K> 调试  <K>/health</K> 检查</Text>,
    <Text key="t3">  <K>/snippet</K> 代码片段  <K>/kb</K> 知识库  <K>/template</K> 模板</Text>,

    <Text key="h6" color={theme.tone.accent} bold>Git 命令</Text>,
    <Text key="git1">  <K>/git status</K> 状态  <K>/git diff</K> 差异  <K>/git log</K> 日志</Text>,
    <Text key="git2">  <K>/git commit</K> 提交  <K>/git branch</K> 分支  <K>/git pr</K> PR</Text>,
    <Text key="git3">  <K>/git blame</K> 逐行  <K>/git compare</K> 对比  <K>/git conflict</K> 冲突</Text>,

    <Text key="h7" color={theme.tone.accent} bold>AI 命令</Text>,
    <Text key="ai1">  <K>/parallel</K> 并行任务  <K>/pipeline</K> 管道  <K>/explore</K> 探索</Text>,
    <Text key="ai2">  <K>/review</K> 审查  <K>/sub</K> 后台任务  <K>/status</K> 状态</Text>,
    <Text key="ai3">  <K>/auto</K> 自动化  <K>/workflow</K> 工作流  <K>/kill</K> 终止</Text>,

    <Text key="h8" color={theme.tone.accent} bold>插件</Text>,
    <Text key="p1" color={theme.fg.sub}>  放在 .mimo/plugins/ 目录，启动时自动加载</Text>,
  ];

  const maxScroll = Math.max(0, lines.length - viewHeight);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visible = lines.slice(clampedScroll, clampedScroll + viewHeight);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.tone.brand} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={theme.tone.brand} bold>❓ 帮助</Text>
        <Text color={theme.fg.meta}>{clampedScroll + 1}/{lines.length} ↑↓滚动 Esc 关闭</Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {visible}
      </Box>
    </Box>
  );
};
