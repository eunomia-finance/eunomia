// Pure device/wallet-classification helpers (issue #9): which wallet options are viable
// on which device class, and how the modal list is ordered. Kept free of kit/init side
// effects so vitest covers the exact logic walletKit.ts runs in production.
import { FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { XBULL_ID } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LOBSTR_ID } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { RABET_ID } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { HANA_ID } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { WALLET_CONNECT_ID } from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";
import type { Device } from "./funnel";
import { NETWORK_LABEL } from "../config";
import { tx } from "./i18n";

// Extension-only wallets: their install path is a desktop browser extension, so on a
// phone they are dead ends. Albedo is deliberately NOT here — it is web-based
// (albedo.link) and works from a mobile browser. Built from the kit's own ID constants
// so a renamed productId breaks the build instead of silently missing at runtime.
export const desktopOnlyWalletIds: ReadonlySet<string> = new Set([
  FREIGHTER_ID,
  XBULL_ID,
  LOBSTR_ID,
  RABET_ID,
  HANA_ID,
]);

// Shown when a phone opens the connect modal — WalletConnect pairs through the wallet
// app, and this build's network has to be selected there or signing fails with a network
// mismatch.
export const MOBILE_WALLET_HINT = `Connect with your wallet app — make sure it's on ${NETWORK_LABEL}`;

/** The same hint in the current language — call it when the hint is shown. */
export const mobileWalletHint = (): string =>
  tx(MOBILE_WALLET_HINT, `Cüzdan uygulamanla bağlan — uygulamada ${NETWORK_LABEL} ağının seçili olduğundan emin ol`);

export type WalletDeviceAvailability = "available" | "desktop-only";

/** Is this wallet a viable tap on this device? Desktop offers everything; mobile hides
 *  the extension-only set. */
export function classifyWalletForDevice(
  device: Device,
  walletId: string,
): WalletDeviceAvailability {
  return device === "mobile" && desktopOnlyWalletIds.has(walletId)
    ? "desktop-only"
    : "available";
}

/** The modal list for a device: drop wallets that are dead ends there, and on mobile
 *  surface WalletConnect first. Desktop keeps the incoming order unchanged. */
export function sortWalletsForDevice<T extends { id: string }>(
  device: Device,
  wallets: T[],
): T[] {
  const visible = wallets.filter(
    (wallet) => classifyWalletForDevice(device, wallet.id) === "available",
  );
  if (device !== "mobile") return visible;
  return [
    ...visible.filter((wallet) => wallet.id === WALLET_CONNECT_ID),
    ...visible.filter((wallet) => wallet.id !== WALLET_CONNECT_ID),
  ];
}
