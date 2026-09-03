/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The chrome is achromatic on purpose: the only warm colour on the
        // page should be the oak in the product photographs.
        paper: '#F0EEE9',
        plate: '#FDFCFA',
        ink: '#191713',
        rule: '#D9D5CC',
        muted: '#7A756B',
        oak: '#75542D', // active step marker and focus ring only — never a fill
        go: '#3D6B4E',
        wait: '#8A6A2A',
      },
      fontFamily: {
        serif: ['"Noto Serif KR"', 'Apple SD Gothic Neo', 'Georgia', 'serif'],
        sans: ['"Noto Sans KR"', '-apple-system', 'BlinkMacSystemFont', '"Apple SD Gothic Neo"', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        label: '0.14em',
      },
    },
  },
  plugins: [],
};
