/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next inlines external Google Fonts at build time. Turning that off keeps the
  // build working on machines without network access to fonts.googleapis.com;
  // the font still loads normally in the browser, and the system stack is a
  // deliberate fallback rather than an accident.
  optimizeFonts: false
};
export default nextConfig;
