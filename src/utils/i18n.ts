// src/utils/i18n.ts - Internationalization system

export type Locale = 'zh' | 'en';

const translations: Record<Locale, Record<string, string>> = {
  zh: {
    // App
    'app.welcome': '欢迎使用 Mimo TUI',
    'app.thinking': '思考中...',
    'app.streaming': '传输中',
    'app.goodbye': '再见！',

    // Commands
    'cmd.new': '新建会话',
    'cmd.clear': '清屏',
    'cmd.help': '帮助',
    'cmd.save': '保存会话',
    'cmd.list': '会话列表',
    'cmd.mode': '切换模式',
    'cmd.model': '切换模型',
    'cmd.compact': '压缩上下文',
    'cmd.retry': '重试',
    'cmd.undo': '撤销',
    'cmd.export': '导出对话',
    'cmd.config': '配置',

    // Status bar
    'status.mode': '模式',
    'status.model': '模型',
    'status.tokens': '令牌',
    'status.streaming': '传输中',
    'status.idle': '就绪',
    'status.git_clean': '干净',
    'status.git_dirty': '未提交变更',

    // Errors
    'error.file_not_found': '文件未找到',
    'error.permission_denied': '权限被拒绝',
    'error.api_error': 'API 错误',
    'error.network_error': '网络连接失败',
    'error.timeout': '请求超时',
    'error.unknown': '未知错误',
    'error.config_invalid': '配置无效',
    'error.tool_not_found': '工具未找到',

    // Tools
    'tool.approval_required': '需要批准执行此工具',
    'tool.executing': '正在执行...',
    'tool.success': '执行成功',
    'tool.failed': '执行失败',

    // Setup
    'setup.welcome': '欢迎！让我们开始配置',
    'setup.api_key': '请输入 API 密钥',
    'setup.base_url': '请输入 API 地址',
    'setup.model': '请选择模型',
    'setup.complete': '配置完成！',

    // Agent modes
    'mode.plan': '计划模式',
    'mode.agent': '智能体模式',
    'mode.yolo': '自动模式',

    // Session
    'session.created': '新会话已创建',
    'session.resumed': '会话已恢复',
    'session.deleted': '会话已删除',
    'session.renamed': '会话已重命名',
    'session.empty': '暂无历史会话',

    // Workflow
    'workflow.started': '工作流已启动',
    'workflow.step': '工作流步骤',
    'workflow.completed': '工作流已完成',
    'workflow.stopped': '工作流已停止',

    // Misc
    'misc.confirm': '确认',
    'misc.cancel': '取消',
    'misc.yes': '是',
    'misc.no': '否',
    'misc.loading': '加载中...',
    'misc.done': '完成',
  },

  en: {
    // App
    'app.welcome': 'Welcome to Mimo TUI',
    'app.thinking': 'Thinking...',
    'app.streaming': 'Streaming',
    'app.goodbye': 'Goodbye!',

    // Commands
    'cmd.new': 'New Session',
    'cmd.clear': 'Clear',
    'cmd.help': 'Help',
    'cmd.save': 'Save Session',
    'cmd.list': 'Session List',
    'cmd.mode': 'Switch Mode',
    'cmd.model': 'Switch Model',
    'cmd.compact': 'Compact Context',
    'cmd.retry': 'Retry',
    'cmd.undo': 'Undo',
    'cmd.export': 'Export Conversation',
    'cmd.config': 'Configuration',

    // Status bar
    'status.mode': 'Mode',
    'status.model': 'Model',
    'status.tokens': 'Tokens',
    'status.streaming': 'Streaming',
    'status.idle': 'Ready',
    'status.git_clean': 'Clean',
    'status.git_dirty': 'Uncommitted changes',

    // Errors
    'error.file_not_found': 'File not found',
    'error.permission_denied': 'Permission denied',
    'error.api_error': 'API Error',
    'error.network_error': 'Network connection failed',
    'error.timeout': 'Request timed out',
    'error.unknown': 'Unknown error',
    'error.config_invalid': 'Invalid configuration',
    'error.tool_not_found': 'Tool not found',

    // Tools
    'tool.approval_required': 'Approval required to execute this tool',
    'tool.executing': 'Executing...',
    'tool.success': 'Execution successful',
    'tool.failed': 'Execution failed',

    // Setup
    'setup.welcome': 'Welcome! Let\'s get started',
    'setup.api_key': 'Please enter your API key',
    'setup.base_url': 'Please enter the API base URL',
    'setup.model': 'Please select a model',
    'setup.complete': 'Setup complete!',

    // Agent modes
    'mode.plan': 'Plan Mode',
    'mode.agent': 'Agent Mode',
    'mode.yolo': 'Auto Mode',

    // Session
    'session.created': 'New session created',
    'session.resumed': 'Session resumed',
    'session.deleted': 'Session deleted',
    'session.renamed': 'Session renamed',
    'session.empty': 'No session history',

    // Workflow
    'workflow.started': 'Workflow started',
    'workflow.step': 'Workflow step',
    'workflow.completed': 'Workflow completed',
    'workflow.stopped': 'Workflow stopped',

    // Misc
    'misc.confirm': 'Confirm',
    'misc.cancel': 'Cancel',
    'misc.yes': 'Yes',
    'misc.no': 'No',
    'misc.loading': 'Loading...',
    'misc.done': 'Done',
  },
};

let currentLocale: Locale = 'zh';

/**
 * Set the active locale for the application.
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * Get the currently active locale.
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Translate a key to the current locale's text.
 *
 * Supports variable interpolation using `{varName}` syntax:
 *   t('error.file_not_found') => 'File not found'
 *   t('status.tokens', { count: '42' }) => '42 Tokens' (if translation uses {count})
 *
 * Falls back to Chinese, then to the raw key if no translation is found.
 */
export function t(key: string, vars?: Record<string, string>): string {
  let text = translations[currentLocale]?.[key] || translations.zh[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return text;
}

/**
 * Get the list of supported locales.
 */
export function getSupportedLocales(): Locale[] {
  return ['zh', 'en'];
}

/**
 * Get all translation keys for the current locale.
 */
export function getTranslationKeys(): string[] {
  return Object.keys(translations[currentLocale] || translations.zh);
}

/**
 * Check if a translation key exists for the current locale.
 */
export function hasTranslation(key: string): boolean {
  return key in (translations[currentLocale] || {}) || key in translations.zh;
}
