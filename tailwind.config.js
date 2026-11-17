/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
        muted: 'var(--color-muted)',
        line: 'var(--color-line)',
        ink: 'var(--color-ink)',
        'ink-muted': 'var(--color-ink-muted)',
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        'on-primary': 'var(--color-on-primary)',
        sky: 'var(--color-sky)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'on-accent': 'var(--color-on-accent)',
        'brand-deep': 'var(--color-brand-deep)',
        danger: 'var(--color-danger)',
        'danger-soft': 'var(--color-danger-soft)',
        'band-strength': 'var(--color-band-strength)',
        'band-developing': 'var(--color-band-developing)',
        'band-development': 'var(--color-band-development)',
        'band-unrated': 'var(--color-band-unrated)',
      },
      fontFamily: {
        // Formidea's typeface, with system fallbacks.
        sans: ['"Public Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        // Crisper corners, closer to Formidea's square style while staying friendly.
        card: '10px',
        xl: '6px',
        '2xl': '8px',
      },
    },
  },
  plugins: [],
};
