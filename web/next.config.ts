import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const config: NextConfig = {
  transpilePackages: ["@probity/shared"],
  poweredByHeader: false,
  // The product moved under /app. Links already sent in Slack messages and e-mails keep working.
  async redirects() {
    return [
      { source: "/inbox", destination: "/app", permanent: true },
      { source: "/r/:id", destination: "/app/r/:id", permanent: true },
      { source: "/settings", destination: "/app/settings", permanent: true },
      { source: "/new", destination: "/app/new", permanent: true },
      { source: "/onboarding", destination: "/app/onboarding", permanent: true },
    ];
  },
};

export default config;
initOpenNextCloudflareForDev();
