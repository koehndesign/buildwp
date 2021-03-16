module.exports = {
  purge: ['./src/**/*.+(html|php|js|svelte)'],
  darkMode: false, // or 'media' or 'class'
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary)',
        secondary: 'var(--secondary)',
        textdark: 'var(--textdark)',
        textlight: 'var(--textlight)',
        bgdark: 'var(--bgdark)',
        bglight: 'var(--bglight)',
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [],
};
