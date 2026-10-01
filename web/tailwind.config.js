/** @type {import('tailwindcss').Config} */

// Burgundy actions and warm neutrals follow the SDD section 6.4 screens.
// Keep the existing token names for compatibility with feature branches.

module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy:    { 950: "#44202C", 900: "#512735", 800: "#612F40", 700: "#713B4D", 600: "#855569" },
        canvas:  "#FAFAF8",
        surface: "#FFFFFF",
        line:    { DEFAULT: "#E3E2E0", strong: "#CCCAC7" },
        ink:     { 900: "#20201F", 700: "#454441", 500: "#686560", 400: "#817D77" },
        accent:  { 50: "#F8EFF2", 100: "#EFDAE1", 600: "#70283E", 700: "#592033" },
        pos:     { 50: "#ECFDF5", 100: "#D1FAE5", 600: "#059669", 700: "#047857" },
        warn:    { 50: "#FFFBEB", 100: "#FEF3C7", 600: "#B45309", 700: "#92400E" },
        exc:     { 50: "#FEF3F2", 100: "#FEE4E2", 600: "#B42318", 700: "#912018" }
      },
      fontFamily: {
        // System fonts keep builds independent of Google Fonts and reduce downloads.
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"]
      },
      borderRadius: { DEFAULT: "6px", md: "6px", lg: "10px", xl: "14px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        pop:  "0 8px 24px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)"
      },
      keyframes: {
        in:      { from: { opacity: 0, transform: "translateY(4px)" },  to: { opacity: 1, transform: "none" } },
        slideUp: { from: { opacity: 0, transform: "translateY(10px)" }, to: { opacity: 1, transform: "none" } }
      },
      animation: { in: "in .18s ease-out", slideUp: "slideUp .2s ease-out" }
    }
  },
  plugins: []
};
