// src/commands/git.ts - Git slash commands

import { getGitInfo, getGitDiff, getRecentCommits } from '../utils/git.js';
import type { CommandContext } from './types.js';

export function handleGitCommand(sub: string, cmdArgs: string[], ctx: CommandContext): void {
  const { setMessages, handleSubmit } = ctx;

  if (sub === 'status') {
    getGitInfo().then(info => {
      const msg = [
        `🔀 **Git 状态**`,
        `分支: \`${info.branch}\``,
        `状态: ${info.status}`,
        info.lastCommit ? `最新提交: ${info.lastCommit}` : '',
      ].filter(Boolean).join('\n');
      setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
    });
  } else if (sub === 'diff') {
    getGitDiff().then(diff => {
      setMessages(prev => [...prev, { role: 'assistant', content: `📝 **Git Diff**\n\`\`\`\n${diff}\n\`\`\`` }]);
    });
  } else if (sub === 'log') {
    const n = parseInt(cmdArgs[0]) || 5;
    getRecentCommits(n).then(log => {
      setMessages(prev => [...prev, { role: 'assistant', content: `📜 **最近 ${n} 次提交**\n${log}` }]);
    });
  } else if (sub === 'commit') {
    getGitDiff().then(diff => {
      if (!diff || diff.trim() === '') {
        setMessages(prev => [...prev, { role: 'assistant', content: '📭 没有需要提交的变更' }]);
        return;
      }
      const customMsg = cmdArgs.slice(0).join(' ');
      if (customMsg) {
        handleSubmit(`请用 shell 执行: git add -A && git commit -m "${customMsg}"`);
      } else {
        handleSubmit(`请根据以下 git diff 生成一个简洁的中文 commit message（遵循 conventional commits 格式），然后执行 git add -A && git commit:\n\n\`\`\`\n${diff.slice(0, 3000)}\n\`\`\``);
      }
    });
  } else if (sub === 'stash' && cmdArgs[0]) {
    const stashSub = cmdArgs[0];
    if (stashSub === 'list') {
      handleSubmit('请用 shell 执行 git stash list 并展示所有 stash');
    } else if (stashSub === 'apply') {
      const n = cmdArgs[1] || '0';
      handleSubmit(`请用 shell 执行 git stash apply stash@{${n}} 并报告结果`);
    } else if (stashSub === 'drop') {
      const n = cmdArgs[1] || '0';
      handleSubmit(`请用 shell 执行 git stash drop stash@{${n}} 并报告结果`);
    }
  } else if (sub === 'stash') {
    handleSubmit('请用 shell 执行 git stash 并告诉我结果');
  } else if (sub === 'branch') {
    handleSubmit('请用 shell 执行 git branch -a 并列出所有分支');
  } else if (sub === 'pr') {
    const prSub = cmdArgs[0];
    if (prSub === 'list') {
      setMessages(prev => [...prev, { role: 'assistant', content: '📋 正在列出开放的 PR...' }]);
      handleSubmit('请用 shell 执行 gh pr list --limit 10 并展示结果');
    } else if (prSub === 'view') {
      const prNumber = cmdArgs[1];
      if (!prNumber) {
        handleSubmit('请用 shell 执行 gh pr view 并展示当前 PR 详情');
      } else {
        handleSubmit(`请用 shell 执行 gh pr view ${prNumber} 并展示结果`);
      }
    } else if (prSub === 'merge') {
      const prNumber = cmdArgs[1];
      if (!prNumber) {
        setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git pr merge [PR 编号]' }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `🔀 正在合并 PR #${prNumber} (squash)...` }]);
        handleSubmit(`请用 shell 执行 gh pr merge ${prNumber} --squash 并报告结果`);
      }
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: '🔍 正在分析分支差异...' }]);
      Promise.all([
        new Promise<string>((resolve) => {
          const { execSync: execSyncPr } = require('child_process');
          try { resolve(execSyncPr('git diff main...HEAD --stat', { encoding: 'utf-8', timeout: 10000 })); } catch { resolve(''); }
        }),
        new Promise<string>((resolve) => {
          const { execSync: execSyncDiff } = require('child_process');
          try { resolve(execSyncDiff('git diff main...HEAD', { encoding: 'utf-8', timeout: 15000 }).slice(0, 6000)); } catch { resolve(''); }
        }),
      ]).then(([stat, diff]) => {
        if (!stat && !diff) {
          setMessages(prev => [...prev, { role: 'assistant', content: '📭 没有发现与 main 分支的差异' }]);
          return;
        }
        handleSubmit(
          `请根据以下 Git 分支差异生成一个 PR 标题和描述，包含以下部分：\n` +
          `1. **变更摘要** - 简要说明本次变更的目的和内容\n` +
          `2. **修改文件列表** - 列出主要修改的文件\n` +
          `3. **测试说明** - 建议如何测试这些变更\n` +
          `4. **破坏性变更** - 如果有破坏性变更请列出，没有则说明无\n\n` +
          `## 变更统计:\n\`\`\`\n${stat}\n\`\`\`\n\n` +
          `## 完整差异:\n\`\`\`\n${diff}\n\`\`\``
        );
      });
    }
  } else if (sub === 'blame') {
    const blameFile = cmdArgs.slice(0).join(' ');
    if (!blameFile) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git blame <文件路径>' }]);
    } else {
      handleSubmit(`请用 shell 执行 git blame "${blameFile}" 并展示结果`);
    }
  } else if (sub === 'conflict') {
    handleSubmit(
      '请用 shell 执行 git diff --name-only --diff-filter=U 查找所有有合并冲突的文件，' +
      '然后读取每个冲突文件的内容，分析冲突标记（<<<<<<< / ======= / >>>>>>>），' +
      '并为每个文件提供解决冲突的建议。如果有 <<<<<<< 标记的文件，请给出推荐的解决方案。'
    );
  } else if (sub === 'compare') {
    const compareBranch = cmdArgs[0];
    if (!compareBranch) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git compare <分支名>' }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: `🔀 正在与 ${compareBranch} 分支对比...` }]);
      new Promise<string>((resolve) => {
        const { execSync: execSyncCmp } = require('child_process');
        try { resolve(execSyncCmp(`git diff ${compareBranch}...HEAD --stat`, { encoding: 'utf-8', timeout: 10000 })); } catch { resolve(''); }
      }).then(stat => {
        if (!stat || stat.trim() === '') {
          setMessages(prev => [...prev, { role: 'assistant', content: `✅ 当前分支与 ${compareBranch} 没有差异` }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: `🔀 **与 ${compareBranch} 的差异**\n\`\`\`\n${stat}\n\`\`\`` }]);
        }
      });
    }
  } else if (sub === 'amend') {
    handleSubmit(
      '请查看 git diff --staged 的内容和最近一次 commit（git log -1 --format="%s%n%n%b"），' +
      '如果暂存区有变更则执行 git commit --amend --no-edit，' +
      '如果没有暂存区变更则提示用户先暂存文件。用中文回复。'
    );
  } else if (sub === 'tag') {
    const tagName = cmdArgs[0];
    if (!tagName) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git tag <标签名>  (如: v1.0.0)' }]);
    } else {
      handleSubmit(`请用 shell 依次执行以下命令：\n1. git tag ${tagName}\n2. git push origin ${tagName}\n\n然后报告结果`);
    }
  } else if (sub === 'clean') {
    handleSubmit(
      '请先用 shell 执行 git clean -fd --dry-run 展示哪些未跟踪文件会被删除，' +
      '然后询问用户是否确认执行。如果用户确认，再执行 git clean -fd 删除这些文件。用中文回复。'
    );
  } else if (sub === 'bisect') {
    const goodCommit = cmdArgs[0];
    const badCommit = cmdArgs[1];
    if (!goodCommit || !badCommit) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git bisect <good_commit> <bad_commit>' }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: '🔍 正在启动 git bisect 自动排查...' }]);
      handleSubmit(
        '请用 shell 工具执行 git bisect 流程: ' +
        '1) git bisect start 2) git bisect bad ' + badCommit +
        ' 3) git bisect good ' + goodCommit +
        ' 4) 在每个 bisect 步骤运行测试，根据结果执行 git bisect good 或 git bisect bad' +
        ' 5) 找到引入 bug 的 commit 后执行 git bisect reset。用中文回复。'
      );
    }
  } else if (sub === 'cherry-pick') {
    const commit = cmdArgs[0];
    if (!commit) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git cherry-pick <commit>' }]);
    } else {
      handleSubmit('请用 shell 执行 git cherry-pick ' + commit + '，如果有冲突则帮助解决。用中文回复。');
    }
  } else if (sub === 'rebase') {
    const rebaseBranch = cmdArgs[0];
    if (!rebaseBranch) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git rebase <branch>' }]);
    } else {
      handleSubmit('请用 shell 执行 git rebase ' + rebaseBranch + '，如果有冲突则帮助解决。用中文回复。');
    }
  } else if (sub === 'hook') {
    const hookType = cmdArgs[0];
    if (hookType === 'pre-commit') {
      handleSubmit(
        '请创建 .git/hooks/pre-commit 文件，内容为运行 lint 和 typecheck 的脚本。如果任一失败则阻止提交。用中文回复。'
      );
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git hook pre-commit' }]);
    }
  } else if (sub === 'undo') {
    setMessages(prev => [...prev, { role: 'assistant', content: '⏪ 正在撤销上一次提交...' }]);
    handleSubmit(
      '请先用 shell 执行 git reflog -5 展示最近 5 次 git 操作，然后执行 git reset --soft HEAD~1 撤销最近一次提交（保留更改在暂存区）。用中文回复结果。'
    );
  } else if (sub === 'sync') {
    setMessages(prev => [...prev, { role: 'assistant', content: '🔄 正在同步远程仓库...' }]);
    handleSubmit(
      '请用 shell 依次执行: git fetch --all && git pull --rebase && git push。如果有冲突则帮助解决。用中文回复结果。'
    );
  } else if (sub === 'graph') {
    handleSubmit('请用 shell 执行 git log --oneline --graph --all -20 并展示结果');
  } else if (sub === 'worktree') {
    const wtSub = cmdArgs[0] || 'list';
    if (wtSub === 'list') {
      handleSubmit('请用 shell 执行 git worktree list 并展示所有工作树');
    } else if (wtSub === 'add') {
      const branch = cmdArgs[1];
      if (!branch) {
        setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git worktree add <branch>' }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `🌳 正在创建工作树: ${branch}...` }]);
        handleSubmit(`请用 shell 执行 git worktree add .worktrees/${branch} ${branch}，然后报告结果。用中文回复。`);
      }
    } else if (wtSub === 'remove') {
      const wtName = cmdArgs[1];
      if (!wtName) {
        setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git worktree remove <name>' }]);
      } else {
        handleSubmit(`请用 shell 执行 git worktree remove .worktrees/${wtName}，然后报告结果。用中文回复。`);
      }
    } else {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❓ 用法: /git worktree <list|add|remove> [参数]\n\n  /git worktree list          - 列出所有工作树\n  /git worktree add <branch>  - 创建新工作树\n  /git worktree remove <name> - 移除工作树',
      }]);
    }
  } else if (sub === 'search') {
    const query = cmdArgs.slice(0).join(' ');
    if (!query) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git search <搜索词>' }]);
    } else {
      handleSubmit(`请用 shell 执行 git log --all --oneline --grep="${query}" -20 并展示结果`);
    }
  } else if (sub === 'recent') {
    handleSubmit('请用 shell 执行 git log --diff-filter=M --name-only --pretty=format: -10 | sort -u 并展示最近修改的文件');
  } else if (sub === 'contributors') {
    handleSubmit('请用 shell 执行 git shortlog -sn --all 并展示贡献者列表');
  } else if (sub === 'release') {
    const version = cmdArgs[0];
    if (!version) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git release <version>  (如: v1.0.0)' }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: `🏷️ 正在创建发布版本: ${version}...` }]);
      handleSubmit(
        `请执行: 1) git log --oneline (最近的 commits) 2) 根据 commits 生成 CHANGELOG 3) git tag ${version} 4) git push origin ${version}`
      );
    }
  } else if (sub === 'wip') {
    setMessages(prev => [...prev, { role: 'assistant', content: '🚧 正在创建 WIP 提交...' }]);
    handleSubmit('请用 shell 执行 git add -A && git commit -m "WIP: work in progress"，然后报告结果');
  } else if (sub === 'issue') {
    const issueTitle = cmdArgs.slice(0).join(' ');
    if (!issueTitle) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git issue <标题>' }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: `📝 正在创建 GitHub Issue: ${issueTitle}...` }]);
      handleSubmit(`请用 shell 执行: gh issue create --title '${issueTitle}' --body '(由 MiMo TUI 自动创建)'`);
    }
  } else if (sub === 'ci') {
    const ciSub = cmdArgs[0];
    if (ciSub === 'logs') {
      setMessages(prev => [...prev, { role: 'assistant', content: '📋 正在获取最新 CI 日志...' }]);
      handleSubmit('请用 shell 执行 gh run view --log 并展示结果');
    } else {
      setMessages(prev => [...prev, { role: 'assistant', content: '🔄 正在检查 CI 状态...' }]);
      handleSubmit('请用 shell 执行 gh run list --limit 5 并展示结果');
    }
  } else if (sub === 'stats') {
    setMessages(prev => [...prev, { role: 'assistant', content: '📊 正在统计 Git 数据...' }]);
    Promise.all([
      new Promise<string>((resolve) => {
        const { execSync: execSyncStats } = require('child_process');
        try {
          resolve(execSyncStats(
            'git log --shortstat --since="1 month ago" | grep "files changed" | awk \'{files+=$1; ins+=$4; del+=$6} END {print "月度统计: 修改 "files" 文件, 新增 "ins" 行, 删除 "del" 行"}\'',
            { encoding: 'utf-8', timeout: 15000, shell: 'bash' }
          ).trim());
        } catch { resolve(''); }
      }),
      new Promise<string>((resolve) => {
        const { execSync: execSyncAuthors } = require('child_process');
        try {
          resolve(execSyncAuthors(
            'git shortlog -sn --since="1 month ago"',
            { encoding: 'utf-8', timeout: 10000 }
          ).trim());
        } catch { resolve(''); }
      }),
    ]).then(([monthlyStats, authorStats]) => {
      const msg = [
        `📊 **Git 月度统计**`,
        ``,
        monthlyStats || '暂无月度数据',
        ``,
        `**本月活跃贡献者**`,
        authorStats || '暂无贡献者数据',
      ].join('\n');
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: msg };
        return updated;
      });
    });
  } else if (sub === 'authors') {
    handleSubmit('请用 shell 执行 git shortlog -sn --all 并展示所有作者及提交次数');
  } else if (sub === 'churn') {
    setMessages(prev => [...prev, { role: 'assistant', content: '🔄 正在分析文件变更频率...' }]);
    handleSubmit('请用 shell 执行 git log --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20 并展示结果');
  } else if (sub === 'timeline') {
    const timelineFile = cmdArgs.slice(0).join(' ');
    if (!timelineFile) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❓ 用法: /git timeline <文件路径>' }]);
    } else {
      handleSubmit(`请用 shell 执行 git log --oneline --follow -20 -- "${timelineFile}" 并展示结果`);
    }
  } else {
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: [
        '❓ 未知的 git 子命令。可用命令:',
        '  /git status   - 查看 Git 状态',
        '  /git diff     - 查看工作区差异',
        '  /git log [n]  - 查看最近 n 次提交',
        '  /git commit   - 智能提交',
        '  /git stash    - 暂存工作区',
        '  /git branch   - 查看所有分支',
        '  /git pr       - 生成 PR 描述',
        '  /git pr list  - 列出开放的 PR',
        '  /git pr view [n] - 查看 PR 详情',
        '  /git pr merge [n] - 合并 PR (squash)',
        '  /git issue <title> - 创建 GitHub Issue',
        '  /git ci       - 查看 CI 状态',
        '  /git ci logs  - 查看最新 CI 日志',
        '  /git blame <file> - 查看文件修改历史',
        '  /git conflict - 帮助解决合并冲突',
        '  /git compare <branch> - 对比分支差异',
        '  /git amend    - 修改最近一次提交',
        '  /git tag <name> - 创建并推送标签',
        '  /git clean    - 清理未跟踪文件',
        '  /git bisect <good> <bad> - 自动排查 bug',
        '  /git cherry-pick <commit> - 摘取提交',
        '  /git rebase <branch> - 变基',
        '  /git hook pre-commit - 设置 pre-commit 钩子',
        '  /git undo     - 撤销上一次提交',
        '  /git sync     - 同步远程仓库',
        '  /git graph    - 可视化提交图',
        '  /git worktree <list|add|remove> - 工作树管理',
        '  /git stash <list|apply|drop> - Stash 管理',
        '  /git search <query> - 搜索提交信息',
        '  /git recent   - 最近修改的文件',
        '  /git contributors - 贡献者列表',
        '  /git release <version> - 创建发布版本',
        '  /git wip      - 快速 WIP 提交',
        '  /git stats    - 月度 Git 统计',
        '  /git authors  - 所有作者及提交次数',
        '  /git churn    - 文件变更频率排名',
        '  /git timeline <file> - 文件提交时间线',
      ].join('\n'),
    }]);
  }
}
