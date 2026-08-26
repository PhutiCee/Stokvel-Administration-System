/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#0A1628", 900: "#101E36", 800: "#1A2B47", 700: "#27395A", 600: "#3A4E72" },
        canvas: "#F7F8FA",
        surface: "#FFFFFF",
        line: { DEFAULT: "#E4E7EC", strong: "#D0D5DD" },
        ink: { 900: "#101828", 700: "#344054", 500: "#667085", 400: "#98A2B3" },
        accent: { 50: "#EEF1FE", 100: "#DFE5FD", 600: "#2F4BD6", 700: "#2439AC" },
        pos: { 50: "#ECFDF5", 100: "#D1FAE5", 600: "#059669", 700: "#047857" },
        warn: { 50: "#FFFBEB", 100: "#FEF3C7", 600: "#B45309", 700: "#92400E" },
        exc: { 50: "#FEF3F2", 100: "#FEE4E2", 600: "#B42318", 700: "#912018" }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      borderRadius: { DEFAULT: "6px", md: "6px", lg: "10px", xl: "14px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        pop: "0 8px 24px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)"
      },
      keyframes: {
        in: { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        slideUp: { from: { opacity: 0, transform: "translateY(10px)" }, to: { opacity: 1, transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } }
      },
      animation: { in: "in .18s ease-out", slideUp: "slideUp .2s ease-out" }
    }
  },
  plugins: []
};
