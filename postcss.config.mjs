/**
 * Tailwind 4 is a PostCSS plugin — no tailwind.config.js. Theme and content
 * detection live in the CSS itself (`src/app/globals.css`).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
