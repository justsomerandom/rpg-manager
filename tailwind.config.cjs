/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter'", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "#38bdf8",
          accent: "#f97316",
        },
      },
      boxShadow: {
        panel: "0 25px 50px rgb(2 6 23 / 0.55)",
      },
      backgroundImage: {
        "radial-grid":
          "radial-gradient(circle at 25% 20%, rgba(56,189,248,0.15), transparent 55%), radial-gradient(circle at 80% 0, rgba(250,204,21,0.08), transparent 55%)",
      },
    },
  },
  plugins: [],
};
