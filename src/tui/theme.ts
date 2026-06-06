// src/tui/theme.ts - Deep semantic theme system (inspired by CodeWhale & Reasonix)

export interface Theme {
  name: string;
  displayName: string;

  // Foreground hierarchy (5 levels like Reasonix)
  fg: {
    strong: string;   // Headings, emphasis
    body: string;     // Primary text
    sub: string;      // Secondary text
    meta: string;     // Metadata, timestamps
    faint: string;    // Dim hints
  };

  // Semantic tones (7 colors like Reasonix)
  tone: {
    brand: string;    // Primary brand color (MiMo blue)
    accent: string;   // Secondary accent
    violet: string;   // Thinking/reasoning
    ok: string;       // Success
    warn: string;     // Warning
    err: string;      // Error
    info: string;     // Informational
  };

  // Surface colors
  surface: {
    bg: string;
    bgInput: string;
    bgCode: string;
    bgElev: string;
  };

  // Card type styling
  card: {
    user: { color: string; glyph: string };
    assistant: { color: string; glyph: string };
    thinking: { color: string; glyph: string };
    tool: { color: string; glyph: string };
    toolSuccess: { color: string; glyph: string };
    toolError: { color: string; glyph: string };
    diff: { color: string; glyph: string };
    error: { color: string; glyph: string };
    plan: { color: string; glyph: string };
    info: { color: string; glyph: string };
  };

  // Pill/chip colors for status bar
  pill: {
    bg: string;
    mode: Record<string, string>;
    model: string;
    cost: string;
    cache: string;
    branch: string;
  };

  // Diff colors
  diff: {
    added: string;
    addedBg: string;
    removed: string;
    removedBg: string;
    context: string;
  };

  // Legacy compatibility aliases (flat properties for easy access)
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  thinking: string;
  code: string;
  border: string;
}

// ========== BUILT-IN THEMES ==========

const GRAPHITE: Theme = {
  name: 'default',
  displayName: 'Graphite',
  fg: {
    strong: '#f1f5f9',
    body: '#e2e8f0',
    sub: '#94a3b8',
    meta: '#64748b',
    faint: '#475569',
  },
  tone: {
    brand: '#7dd3fc',
    accent: '#c084fc',
    violet: '#a78bfa',
    ok: '#86efac',
    warn: '#fbbf24',
    err: '#f87171',
    info: '#7dd3fc',
  },
  surface: {
    bg: '#0b1020',
    bgInput: '#0f172a',
    bgCode: '#1e293b',
    bgElev: '#1e293b',
  },
  card: {
    user:       { color: '#7dd3fc', glyph: '◇' },
    assistant:  { color: '#e2e8f0', glyph: '◆' },
    thinking:   { color: '#a78bfa', glyph: '💭' },
    tool:       { color: '#fbbf24', glyph: '⚡' },
    toolSuccess:{ color: '#86efac', glyph: '✓' },
    toolError:  { color: '#f87171', glyph: '✗' },
    diff:       { color: '#34d399', glyph: '📝' },
    error:      { color: '#f87171', glyph: '❌' },
    plan:       { color: '#c084fc', glyph: '🔍' },
    info:       { color: '#7dd3fc', glyph: 'ℹ' },
  },
  pill: {
    bg: '#1e293b',
    mode: { plan: '#c084fc', agent: '#7dd3fc', yolo: '#fbbf24' },
    model: '#64748b',
    cost: '#fbbf24',
    cache: '#86efac',
    branch: '#64748b',
  },
  diff: {
    added: '#86efac',
    addedBg: '#052e16',
    removed: '#f87171',
    removedBg: '#450a0a',
    context: '#64748b',
  },
  // Legacy aliases
  primary: '#7dd3fc',
  secondary: '#86efac',
  accent: '#c084fc',
  success: '#86efac',
  warning: '#fbbf24',
  error: '#f87171',
  muted: '#64748b',
  thinking: '#a78bfa',
  code: '#c084fc',
  border: '#475569',
};

const WHALE: Theme = {
  ...GRAPHITE,
  name: 'whale',
  displayName: 'Whale Dark',
  fg: { strong: '#F0F4F8', body: '#CBD5E1', sub: '#8899AA', meta: '#667788', faint: '#445566' },
  tone: { brand: '#F6C453', accent: '#4FD1C5', violet: '#B794F4', ok: '#68D391', warn: '#F6AD55', err: '#FC8181', info: '#63B3ED' },
  surface: { bg: '#0A1120', bgInput: '#0D1829', bgCode: '#1A2744', bgElev: '#1A2744' },
  primary: '#F6C453',
  secondary: '#68D391',
  accent: '#4FD1C5',
  success: '#68D391',
  warning: '#F6AD55',
  error: '#FC8181',
  thinking: '#B794F4',
  code: '#4FD1C5',
  border: '#445566',
};

const MATRIX: Theme = {
  ...GRAPHITE,
  name: 'matrix',
  displayName: 'Matrix',
  fg: { strong: '#00FF41', body: '#00CC33', sub: '#008F11', meta: '#005500', faint: '#003300' },
  tone: { brand: '#00FF41', accent: '#39FF14', violet: '#00FF41', ok: '#00FF41', warn: '#ADFF2F', err: '#FF0000', info: '#00FF41' },
  surface: { bg: '#000000', bgInput: '#0A0A0A', bgCode: '#0D1A0D', bgElev: '#0D1A0D' },
  primary: '#00FF41',
  secondary: '#00CC33',
  accent: '#39FF14',
  success: '#00FF41',
  warning: '#ADFF2F',
  error: '#FF0000',
  thinking: '#00FF41',
  code: '#39FF14',
  border: '#003300',
};

const DRACULA: Theme = {
  ...GRAPHITE,
  name: 'dracula',
  displayName: 'Dracula',
  fg: { strong: '#F8F8F2', body: '#F8F8F2', sub: '#BFBFBF', meta: '#6272A4', faint: '#44475A' },
  tone: { brand: '#8BE9FD', accent: '#FF79C6', violet: '#BD93F9', ok: '#50FA7B', warn: '#FFB86C', err: '#FF5555', info: '#8BE9FD' },
  surface: { bg: '#282A36', bgInput: '#343746', bgCode: '#44475A', bgElev: '#44475A' },
  primary: '#8BE9FD',
  secondary: '#50FA7B',
  accent: '#FF79C6',
  success: '#50FA7B',
  warning: '#FFB86C',
  error: '#FF5555',
  thinking: '#BD93F9',
  code: '#FF79C6',
  border: '#44475A',
};

const SOLARIZED_LIGHT: Theme = {
  ...GRAPHITE,
  name: 'solarized',
  displayName: 'Solarized Light',
  fg: { strong: '#073642', body: '#586E75', sub: '#93A1A1', meta: '#B0BEC5', faint: '#D0D7DE' },
  tone: { brand: '#268BD2', accent: '#2AA198', violet: '#6C71C4', ok: '#859900', warn: '#CB4B16', err: '#DC322F', info: '#268BD2' },
  surface: { bg: '#FDF6E3', bgInput: '#EEE8D5', bgCode: '#E8E0CC', bgElev: '#E8E0CC' },
  primary: '#268BD2',
  secondary: '#859900',
  accent: '#2AA198',
  success: '#859900',
  warning: '#CB4B16',
  error: '#DC322F',
  thinking: '#6C71C4',
  code: '#2AA198',
  border: '#D0D7DE',
};

// ========== THEME REGISTRY ==========

const THEMES: Record<string, Theme> = {
  default: GRAPHITE,
  whale: WHALE,
  matrix: MATRIX,
  dracula: DRACULA,
  solarized: SOLARIZED_LIGHT,
};

export function getTheme(name: string): Theme {
  return THEMES[name] || GRAPHITE;
}

export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

export function getThemeDisplayName(name: string): string {
  return (THEMES[name] || GRAPHITE).displayName;
}
