/** @type {import('tailwindcss').Config} */
// Same token set as DevPilot's web app, on purpose: two products under one brand
// should not look like two companies, and a shared palette means a component can be
// lifted between them without a redesign.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables (see index.css) so the whole palette — and every
        // existing `white/…` utility — flips between dark and light themes.
        base: {
          DEFAULT: 'rgb(var(--base-rgb) / <alpha-value>)',
          elevated: 'rgb(var(--base-elevated-rgb) / <alpha-value>)',
          surface: 'rgb(var(--base-surface-rgb) / <alpha-value>)',
          hover: 'rgb(var(--base-hover-rgb) / <alpha-value>)',
        },
        // `white` is redefined as the theme foreground, so `text-white/70`,
        // `bg-white/[0.03]`, `border-white/10` become dark ink in light mode.
        white: 'rgb(var(--fg-rgb) / <alpha-value>)',
        // Fills. Text in the accent colour uses `textColor.accent` below, which is lighter on dark
        // and darker on light so small text keeps 4.5:1 (white on the fill passes in both themes).
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover-rgb) / <alpha-value>)',
          muted: '#4F46E5',
          soft: 'rgb(var(--accent-rgb) / 0.14)',
        },
        // Status colours flip with the theme too: the bright greens and reds of the dark theme fail contrast on white.
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        warning: 'rgb(var(--warning-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warning-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        // 0.08 is invisible on a light background — every card loses its edge and the
        // page reads as one flat sheet. 0.14 is still a hairline in the dark.
        hairline: 'rgb(var(--fg-rgb) / 0.14)',
        glass: 'rgb(var(--fg-rgb) / 0.04)',
      },
      textColor: {
        // `base` is also a colour (the page background), so `text-base` used as a font size ALSO painted text in the
        // background colour: dark on dark, invisible. Six headings had this. Make the colour half inherit.
        base: 'inherit',
        accent: {
          DEFAULT: 'rgb(var(--accent-text-rgb) / <alpha-value>)',
          hover: 'rgb(var(--accent-text-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
      },
      boxShadow: {
        ambient: '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.28)',
        glow: '0 0 0 1px rgb(var(--accent-rgb) / 0.3), 0 8px 24px rgb(var(--accent-rgb) / 0.18)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(0.8)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        fadeIn: 'fadeIn 200ms ease-out',
        pulseDot: 'pulseDot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
