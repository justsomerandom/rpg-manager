/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        display: ["Aptos Display", "Segoe UI Variable Display", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        slate: {
          50: "#f4f8f0",
          100: "#e3f2db",
          200: "#cddfc8",
          300: "#a9c2ad",
          400: "#7fa18b",
          // Kept light enough for small secondary text on grove panels (WCAG AA).
          500: "#789989",
          600: "#456055",
          700: "#30453c",
          800: "#1d2d25",
          900: "#101b15",
          950: "#050c08",
        },
        brand: {
          DEFAULT: "#1f9c73",
          accent: "#c28f5c",
          deep: "#0a1f16",
          glow: "#e3f2db",
        },
        grove: {
          900: "#03130d",
          800: "#0b2519",
          700: "#123425",
          600: "#1b4733",
        },
        earth: {
          clay: "#a76634",
          moss: "#5f7f39",
          sand: "#e7d3b0",
        },
      },
      boxShadow: {
        panel: "0 25px 45px rgb(3 19 13 / 0.6)",
      },
      backgroundImage: {
        "radial-grid":
          "radial-gradient(circle at 20% 20%, rgba(31,156,115,0.18), transparent 52%), radial-gradient(circle at 80% 0, rgba(194,143,92,0.18), transparent 60%)",
      },
    },
  },
  plugins: [],
};
