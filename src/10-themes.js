// ============================================================================
// THEMES — variable→value maps applied to documentElement (mikupad-style
// dynamic theming). Every theme sets the same keys; derived vars (--c-dim,
// --c-faint, --c-accent-dim, --c-border) are computed in static CSS from
// these, so adding a theme is just a new entry here.
// ============================================================================
const THEMES = {
  defaultTheme: {
    name: 'Dark (default)',
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': 'oklch(0.18 0.020 60)',
      '--c-bg-1': 'oklch(0.22 0.020 60)',
      '--c-bg-2': 'oklch(0.29 0.025 60)',
      '--c-bg-3': 'oklch(0.36 0.030 60)',
      '--c-chrome': 'oklch(0.22 0.020 60)',
      '--c-text': 'oklch(0.95 0.040 70)',
      '--c-accent': 'oklch(0.75 0.120 70)',
      '--c-danger': 'oklch(0.65 0.20 25)',
      '--c-warning': 'oklch(0.80 0.15 80)',
      '--c-pin': 'oklch(0.80 0.15 80)',
      '--c-user': 'oklch(0.78 0.10 65)',
      '--c-action': 'oklch(0.74 0.05 75)',
      '--c-dialogue': 'oklch(0.95 0.040 70)',
      '--c-good': 'oklch(0.78 0.12 155)',
      '--c-ooc': 'oklch(0.70 0.04 75)',
      '--c-speaker-s': '65%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
  'ctp-mocha': {
    name: 'Catppuccin Mocha', accentable: true,
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': '#181825', '--c-bg-1': '#1e1e2e', '--c-bg-2': '#313244', '--c-bg-3': '#45475a', '--c-chrome': '#1e1e2e',
      '--c-text': '#cdd6f4',
      '--c-danger': '#f38ba8',
      '--c-warning': '#f9e2af',
      '--c-pin': '#f9e2af',
      '--c-action': '#a6adc8',
      '--c-ooc': '#a6adc8',
      '--c-speaker-s': '60%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
  'ctp-macchiato': {
    name: 'Catppuccin Macchiato', accentable: true,
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': '#1e2030', '--c-bg-1': '#24273a', '--c-bg-2': '#363a4f', '--c-bg-3': '#494d64', '--c-chrome': '#24273a',
      '--c-text': '#cad3f5',
      '--c-danger': '#ed8796',
      '--c-warning': '#eed49f',
      '--c-pin': '#eed49f',
      '--c-action': '#a5adcb',
      '--c-ooc': '#a5adcb',
      '--c-speaker-s': '60%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
  'ctp-frappe': {
    name: 'Catppuccin Frappé', accentable: true,
    vars: {
      'color-scheme': 'dark',
      '--c-bg-0': '#292c3c', '--c-bg-1': '#303446', '--c-bg-2': '#414559', '--c-bg-3': '#51576d', '--c-chrome': '#303446',
      '--c-text': '#c6d0f5',
      '--c-danger': '#e78284',
      '--c-warning': '#e5c890',
      '--c-pin': '#e5c890',
      '--c-action': '#a5adce',
      '--c-ooc': '#a5adce',
      '--c-speaker-s': '60%',
      '--c-speaker-l': '72%',
      '--font-prose': 'system-ui, sans-serif',
    },
  },
};

// Official Catppuccin accent colors per flavor (https://catppuccin.com/palette).
// On accentable themes the chosen accent drives --c-accent / --c-user /
// --c-dialogue (quotes, names on bubbles, buttons/highlights). Default: mauve
// (the pink/lavender of the palette).
const CTP_ACCENTS = {
  'ctp-mocha': {
    rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7',
    red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387', yellow: '#f9e2af',
    green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec',
    blue: '#89b4fa', lavender: '#b4befe',
  },
  'ctp-macchiato': {
    rosewater: '#f4dbd6', flamingo: '#f0c6c6', pink: '#f5bde6', mauve: '#c6a0f6',
    red: '#ed8796', maroon: '#ee99a0', peach: '#f5a97f', yellow: '#eed49f',
    green: '#a6da95', teal: '#8bd5ca', sky: '#91d7e3', sapphire: '#7dc4e4',
    blue: '#8aadf4', lavender: '#b7bdf8',
  },
  'ctp-frappe': {
    rosewater: '#f2d5cf', flamingo: '#eebebe', pink: '#f4b8e4', mauve: '#ca9ee6',
    red: '#e78284', maroon: '#ea999c', peach: '#ef9f76', yellow: '#e5c890',
    green: '#a6d189', teal: '#81c8be', sky: '#99d1db', sapphire: '#85c1dc',
    blue: '#8caaee', lavender: '#babbf1',
  },
};
const DEFAULT_ACCENT = 'pink';

function applyTheme(id, accentId = DEFAULT_ACCENT) {
  const theme = THEMES[id] ?? THEMES.defaultTheme;
  const style = document.documentElement.style;
  for (const [k, v] of Object.entries(theme.vars)) style.setProperty(k, v);
  if (theme.accentable) {
    const palette = CTP_ACCENTS[id] ?? {};
    const hex = palette[accentId] ?? palette[DEFAULT_ACCENT];
    for (const v of ['--c-accent', '--c-user', '--c-dialogue']) style.setProperty(v, hex);
    style.setProperty('--c-good', palette.green ?? '#a6e3a1');
  } else {
    // restore the theme's own values if an accentable theme set them before
    for (const v of ['--c-accent', '--c-user', '--c-dialogue', '--c-good']) style.removeProperty(v);
    for (const [k, v2] of Object.entries(theme.vars)) style.setProperty(k, v2);
  }
}

