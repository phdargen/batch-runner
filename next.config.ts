import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_DEV: process.env.NEXT_DEV ?? "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
