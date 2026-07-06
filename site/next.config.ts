import type { NextConfig } from "next";

// Static export for GitHub Pages. NEXT_PUBLIC_BASE_PATH is set to "/wigolo"
// by the Pages workflow (project pages live under the repo path); local dev
// leaves it unset and everything serves from /.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
