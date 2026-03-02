/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dmsBg: "#0b1120",
        dmsCard: "#111827",
        dmsAccent: "#38bdf8",
        dmsDanger: "#f97373",
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
}
