import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @lancedb/lancedb 是带 .node 原生二进制的嵌入式向量库，
  // 不能被 Turbopack 打进 ESM chunk，需作为服务端外部依赖在运行时 require。
  serverExternalPackages: ["@lancedb/lancedb"],
};

export default nextConfig;
