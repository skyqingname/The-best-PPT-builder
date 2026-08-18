import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@resvg/resvg-js"],
  // Next.js 开发浮层只有英文，没有 locale。关掉，避免当成产品设置。
  devIndicators: false,
};

export default nextConfig;
