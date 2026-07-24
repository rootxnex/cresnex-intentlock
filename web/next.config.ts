import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Optional native/debug dependencies referenced by unused connector paths.
    // Browser-injected and WalletConnect connectors do not require them.
    config.resolve.alias["@react-native-async-storage/async-storage"] = false;
    config.resolve.alias["pino-pretty"] = false;
    return config;
  },
};

export default nextConfig;
