import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const config: NextConfig = {
  transpilePackages: ["@probity/shared"],
  poweredByHeader: false,
};

export default config;
initOpenNextCloudflareForDev();
