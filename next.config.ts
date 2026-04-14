import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module — let Next.js require() it at runtime
  // from node_modules instead of trying to bundle the binary.
  serverExternalPackages: ["better-sqlite3"]
};

export default nextConfig;
