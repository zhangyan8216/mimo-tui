// src/tui/SetupWizard.tsx - First-run setup wizard

import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import type { Theme } from './theme.js';
import type { Config } from '../config.js';

interface SetupWizardProps {
  theme: Theme;
  onComplete: (config: Config) => void;
  onCancel: () => void;
}

type Step = 'welcome' | 'api_key' | 'model' | 'mode' | 'confirm';

const MODELS = [
  { value: 'mimo-v2.5-pro', label: 'MiMo v2.5 Pro', description: '最高质量，较高成本' },
  { value: 'mimo-v2.5-flash', label: 'MiMo v2.5 Flash', description: '更快速，较低成本' },
];

export const SetupWizard: React.FC<SetupWizardProps> = ({ theme, onComplete, onCancel }) => {
  const [step, setStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState(0);
  const [selectedMode, setSelectedMode] = useState(1); // agent
  const [inputBuffer, setInputBuffer] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    switch (step) {
      case 'welcome':
        if (key.return) setStep('api_key');
        break;

      case 'api_key':
        if (key.return && inputBuffer.trim()) {
          setApiKey(inputBuffer.trim());
          setInputBuffer('');
          setStep('model');
        } else if (key.backspace) {
          setInputBuffer(prev => prev.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setInputBuffer(prev => prev + input);
        }
        break;

      case 'model':
        if (key.upArrow) setSelectedModel(prev => Math.max(0, prev - 1));
        if (key.downArrow) setSelectedModel(prev => Math.min(MODELS.length - 1, prev + 1));
        if (key.return) setStep('mode');
        break;

      case 'mode':
        if (key.upArrow) setSelectedMode(prev => Math.max(0, prev - 1));
        if (key.downArrow) setSelectedMode(prev => Math.min(2, prev + 1));
        if (key.return) setStep('confirm');
        break;

      case 'confirm':
        if (key.return) {
          onComplete({
            provider: {
              apiKey,
              baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
              model: MODELS[selectedModel].value,
            },
            agent: {
              mode: (['plan', 'agent', 'yolo'] as const)[selectedMode],
              maxIterations: 32,
              autoApproveReads: true,
              thinkingEnabled: true,
              reasoningEffort: 'medium',
            },
            ui: {
              theme: 'default',
              showThinking: true,
              showTokens: true,
              compactMode: false,
            },
            mcp: { servers: [] },
          });
        }
        break;
    }
  });

  return (
    <Box flexDirection="column" padding={2}>
      {/* Welcome */}
      {step === 'welcome' && (
        <Box flexDirection="column" alignItems="center">
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>
              {'╔══════════════════════════════════════╗'}
            </Text>
          </Box>
          <Box>
            <Text color={theme.primary} bold>
              {'║   🐱  Mimo TUI 设置向导  🐱     ║'}
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>
              {'╚══════════════════════════════════════╝'}
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text>欢迎使用 Mimo TUI - 终端 AI 编程助手</Text>
          </Box>
          <Box marginBottom={1}>
            <Text dimColor>基于小米 MiMo 模型</Text>
          </Box>
          <Box>
            <Text color={theme.accent}>按 Enter 开始设置...</Text>
          </Box>
        </Box>
      )}

      {/* API Key */}
      {step === 'api_key' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>步骤 1/4: API Key</Text>
          </Box>
          <Box marginBottom={1}>
            <Text>请输入您的 MiMo API Key（来自 platform.xiaomimimo.com）</Text>
          </Box>
          <Box>
            <Text color={theme.accent}>API Key: </Text>
            <Text>{apiKey ? '*'.repeat(apiKey.length) : inputBuffer}</Text>
            <Text color={theme.primary}>▊</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor color={theme.muted}>按 Enter 继续</Text>
          </Box>
        </Box>
      )}

      {/* Model Selection */}
      {step === 'model' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>步骤 2/4: 选择模型</Text>
          </Box>
          {MODELS.map((model, i) => (
            <Box key={model.value} paddingLeft={2}>
              <Text color={i === selectedModel ? theme.primary : undefined} bold={i === selectedModel}>
                {i === selectedModel ? '▸ ' : '  '}
                {model.label}
              </Text>
              <Text dimColor> - {model.description}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor color={theme.muted}>↑↓ 导航 · Enter 选择</Text>
          </Box>
        </Box>
      )}

      {/* Mode Selection */}
      {step === 'mode' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>步骤 3/4: 默认模式</Text>
          </Box>
          {[
            { icon: '🔍', name: '计划', desc: '只读调查模式' },
            { icon: '🤖', name: '智能体', desc: '交互式审批模式（推荐）' },
            { icon: '⚡', name: '自动', desc: '自动批准所有操作' },
          ].map((mode, i) => (
            <Box key={mode.name} paddingLeft={2}>
              <Text color={i === selectedMode ? theme.primary : undefined} bold={i === selectedMode}>
                {i === selectedMode ? '▸ ' : '  '}
                {mode.icon} {mode.name}
              </Text>
              <Text dimColor> - {mode.desc}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor color={theme.muted}>↑↓ 导航 · Enter 选择</Text>
          </Box>
        </Box>
      )}

      {/* Confirmation */}
      {step === 'confirm' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>步骤 4/4: 确认设置</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={2} borderStyle="round" borderColor={theme.border}>
            <Text><Text bold>API Key:</Text> {'*'.repeat(8)}...{apiKey.slice(-4)}</Text>
            <Text><Text bold>基础地址:</Text> https://token-plan-cn.xiaomimimo.com/anthropic</Text>
            <Text><Text bold>模型:</Text> {MODELS[selectedModel].label}</Text>
            <Text><Text bold>模式:</Text> {['计划', '智能体', '自动'][selectedMode]}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.success} bold>按 Enter 保存并开始！</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
