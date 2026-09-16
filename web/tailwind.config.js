/** @type {import('tailwindcss').Config} */

// Design tokens.
//
// The palette is carried over unchanged from the approved UI prototype, so the
// delivered system looks like the design the group signed off on.
//
//   navy    the signed-in chrome and the sign-in panel. Institutional, calm,
//           and dark enough that white text on it clears WCAG AA comfortably.
//   ink     text, in four weights of grey rather than pure black
//   accent  the single action colour. Exactly one thing on a screen is this
//           colour: the action the person came to perform.
//   pos     money in, paid, in good standing
//   warn    needs attention but is not yet wrong
//   exc     an exception: a refusal, an unexplained difference, an arrear
//
// There is no decorative colour in this system. Every colour above carries a
// meaning, because in a book of account a colour that means nothing is worse
// than no colour at all.

module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy:    { 950: "#0A1628", 900: "#101E36", 800: "#1A2B47", 700: "#27395A", 600: "#3A4E72" },
        canvas:  "#F7F8FA",
        surface: "#FFFFFF",
        line:    { DEFAULT: "#E4E7EC", strong: "#D0D5DD" },
        ink:     { 900: "#101828", 700: "#344054", 500: "#667085", 400: "#98A2B3" },
        accent:  { 50: "#EEF1FE", 100: "#DFE5FD", 600: "#2F4BD6", 700: "#2439AC" },
        pos:     { 50: "#ECFDF5", 100: "#D1FAE5", 600: "#059669", 700: "#047857" },
        warn:    { 50: "#FFFBEB", 100: "#FEF3C7", 600: "#B45309", 700: "#92400E" },
        exc:     { 50: "#FEF3F2", 100: "#FEE4E2", 600: "#B42318", 700: "#912018" }
      },
      fontFamily: {
        // Set by next/font in app/layout.js. IBM Plex Sans throughout, with
        // Plex Mono reserved for figures in the ledger and for reference codes.
        sans: ["var(--font-plex-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"]
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
