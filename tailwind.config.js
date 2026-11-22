/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        hextech: {
          bg: "#010A13",
          surface: "#091428",
          gold: "#C8AA6E",
          goldBright: "#F0E6D2",
          teal: "#0AC8B9",
          danger: "#E84057",
          muted: "#A09B8C",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
