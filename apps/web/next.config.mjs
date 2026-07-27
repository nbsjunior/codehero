/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export → Firebase Hosting files only (no frameworks SSR / sharp Cloud Build).
  output: "export",
  // Gera docs/index.html (e não docs.html) para /docs e /docs/ funcionarem no Hosting.
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["mermaid"],
};

export default nextConfig;
