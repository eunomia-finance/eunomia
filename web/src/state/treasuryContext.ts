// Context + types live apart from the provider component (react-refresh rule: a file
// exporting a component must export nothing else).
import { createContext } from "react";
import type { Lifecycle, EunomiaState } from "../lib/userTreasury";
import type { TreasuryRef } from "../lib/treasuryList";

// One in-flight wallet action at a time (a wallet signs one tx at a time) — the key
// names WHICH action runs, so its button can show progress while the rest stay locked.
export type Busy =
  | null
  | "connect"
  | "friendbot"
  | "deploy"
  | "fund"
  | "whitelist"
  | "removePayee"
  | "spend"
  | "session"
  | "revoke"
  | "task"
  | "pause"
  | "withdraw"
  | "limits"
  | "register";

/** validation:true = the wallet popup never opened; show `msg` inline at the form. */
export interface ActionOutcome {
  ok: boolean;
  msg: string;
  hash?: string;
  validation?: boolean;
}

export interface TreasuryContextValue {
  address: string | null;
  treasuryId: string | null;
  state: EunomiaState | null;
  lifecycle: Lifecycle | null;
  legacy: boolean;
  sessionActive: boolean;
  sessionSecret: string | null;
  walletXlm: number | null | undefined;
  loading: boolean;
  busy: Busy;
  refreshKey: number;
  treasuries: TreasuryRef[];
  refresh: (opts?: { markLoading?: boolean }) => Promise<void>;
  connect: () => Promise<void>;
  friendbot: () => Promise<ActionOutcome>;
  deploy: (daily: string, perTask: string) => Promise<ActionOutcome>;
  openExisting: (id: string) => ActionOutcome;
  fund: (amount: string) => Promise<ActionOutcome>;
  whitelist: (payeeAddr: string) => Promise<ActionOutcome>;
  removePayeeAddr: (payeeAddr: string) => Promise<ActionOutcome>;
  spend: (to: string, amount: string) => Promise<ActionOutcome>;
  /** `agentPublicKey` (optional): authorise an external agent's own key instead of
   *  generating a local session key — the eunomia-mcp handshake. */
  startLeash: (cap: string, hours: string, agentPublicKey?: string) => Promise<ActionOutcome>;
  revokeLeash: () => Promise<ActionOutcome>;
  runAutonomousTask: (to?: string) => Promise<ActionOutcome>;
  togglePause: () => Promise<ActionOutcome>;
  withdraw: (to: string, amount: string) => Promise<ActionOutcome>;
  updateLimits: (daily: string, perTask: string) => Promise<ActionOutcome>;
  registerActive: () => Promise<ActionOutcome>;
  switchTreasury: (id: string) => void;
  forgetTreasury: (id: string) => void;
  /** True while the user deliberately walks the create-new wizard despite having a
   *  treasury open — suppresses the registry auto-adopt so Setup can render. */
  creatingNew: boolean;
  startNewTreasury: () => void;
  cancelNewTreasury: () => void;
}

export const TreasuryContext = createContext<TreasuryContextValue | null>(null);
