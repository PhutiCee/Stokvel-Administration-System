/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API is a separate Express service (SDD 4.1, three tiers). Next.js does
  // no data access of its own and holds no database credentials.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
  }
};

export default nextConfig;
