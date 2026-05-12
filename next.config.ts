import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ssh2", "tunnel-ssh", "mysql2", "pg", "pdf-parse"],
};

export default nextConfig;
