// Light/dark theme: persisted in localStorage, applied as data-theme on <html>.
// The whole palette is CSS-variable driven (see index.css + tailwind.config.js), so
// flipping this attribute re-themes the entire app.
export type Theme = 'dark' | 'light'

const KEY = 'adspilot-theme'

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private mode / storage disabled — theme still applies for this session */
  }
}

/** Set the initial theme as early as possible (called from main.tsx before render). */
export function initTheme(): void {
  applyTheme(getTheme())
}

/** Flip the theme and return the new value. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
