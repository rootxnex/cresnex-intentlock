"use client";

import type { IWalletKit } from "@reown/walletkit";

let singleton: Promise<IWalletKit> | null = null;

/**
 * Browser-only WalletKit instance.
 *
 * A custom storage prefix prevents the wallet-side WalletKit instance from
 * colliding with the dapp-side WalletConnect connector already used by wagmi.
 */
export function getIntentLockWalletKit(): Promise<IWalletKit> {
  if (typeof window === "undefined") {
    throw new Error("IntentLock WalletKit can only run in the browser");
  }

  const projectId =
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not configured",
    );
  }

  if (!singleton) {
    singleton = (async () => {
      const [{ Core }, { WalletKit }] = await Promise.all([
        import("@walletconnect/core"),
        import("@reown/walletkit"),
      ]);

      const core = new Core({
        projectId,
        customStoragePrefix: "cresnex-intentlock-walletkit",
      });

      return WalletKit.init({
        core,
        name: "cresnex-intentlock-walletkit",
        metadata: {
          name: "Cresnex IntentLock",
          description:
            "Runtime policy enforcement for autonomous Web3 wallets",
          url: window.location.origin,
          icons: [
            `${window.location.origin}/brand/cresnex-intentlock-logo.png`,
          ],
        },
      });
    })();
  }

  return singleton;
}
