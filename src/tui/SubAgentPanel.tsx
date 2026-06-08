// src/tui/SubAgentPanel.tsx - Real-time sub-agent progress display

import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import type { Theme } from './theme.js';
import type { SubAgentTask } from '../agent/sub-agent.js';

interface SubAgentPanelProps {
  tasks: SubAgentTask[];
  theme: Theme;
}

export const SubAgentPanel: React.FC<SubAgentPanelProps> = ({ tasks, theme }) => {
  const [, setTick] = useState(0);

  // Re-render every second when there are running tasks
  const hasRunning = tasks.some(t => t.status === 'running' || t.status === 'queued');
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunning]);

  if (tasks.length === 0) return null;

  const running = tasks.filter(t => t.status === 'running');
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed');
  const queued = tasks.filter(t => t.status === 'queued');
  const cancelled = tasks.filter(t => t.status === 'cancelled');

  // Only show if there are active tasks or recently completed ones
  const activeTasks = [...running, ...queued];
  const recentCompleted = [...completed, ...failed, ...cancelled].filter(
    t => t.endTime && Date.now() - t.endTime < 10000 // Show for 10 seconds after completion
  );

  if (activeTasks.length === 0 && recentCompleted.length === 0) return null;

  const displayTasks = [...activeTasks, ...recentCompleted.slice(-3)];

  const getStatusIcon = (status: SubAgentTask['status']) => {
    switch (status) {
      case 'running': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'cancelled': return '⏹️';
      case 'queued': return '⏳';
    }
  };

  const getStatusColor = (status: SubAgentTask['status']) => {
    switch (status) {
      case 'running': return theme.tone.brand;
      case 'completed': return theme.tone.ok;
      case 'failed': return theme.tone.err;
      case 'cancelled': return theme.fg.faint;
      case 'queued': return theme.fg.sub;
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.tone.brand} paddingX={1} marginY={0}>
      {/* Header */}
      <Box>
        <Text color={theme.tone.brand} bold>⚡ Sub-Agents </Text>
        <Text color={theme.fg.meta}>
          {completed.length}/{tasks.length} 完成
          {running.length > 0 ? ` · ${running.length} 运行中` : ''}
          {queued.length > 0 ? ` · ${queued.length} 排队` : ''}
          {failed.length > 0 ? ` · ${failed.length} 失败` : ''}
        </Text>
      </Box>

      {/* Task list */}
      {displayTasks.map(task => {
        const icon = getStatusIcon(task.status);
        const color = getStatusColor(task.status);
        const duration = task.duration
          ? ` (${(task.duration / 1000).toFixed(1)}s)`
          : task.startTime
            ? ` (${((Date.now() - task.startTime) / 1000).toFixed(0)}s...)`
            : '';

        return (
          <Box key={task.id} paddingLeft={1}>
            <Text color={color}>
              {icon} {task.name} [{task.status}]{duration}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
