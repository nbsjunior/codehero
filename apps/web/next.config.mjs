/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export → Firebase Hosting files only (no frameworks SSR / sharp Cloud Build).
  output: "export",
  images: { unoptimized: true },
  transpilePackages: ["mermaid"],
};

export default nextConfig;
