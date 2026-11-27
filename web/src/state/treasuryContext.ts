// Context + types live apart from the provider component (react-refresh rule: a file
// exporting a component must export nothing else).
import { createContext } from "react";
import type { Lifecycle, EunomiaState } from "../lib/userTreasury";
import type { TreasuryRef } from "../lib/treasuryList";
import type { TokenCode } from "../lib/token";
import type { BudgetRequest } from "../lib/budgetRequestCodec";
import type { SetupStep } from "../lib/agentSetup";

// One in-flight wallet action at a time (a wallet signs one tx at a time) — the key
// names WHICH action runs, so its button can show progress while the rest stay locked.
export type Busy =
  | null
  | "connect"
  | "deploy"
  | "fund"
  | "whitelist"
  | "removePayee"
  | "spend"
  | "session"
  | "revoke"
  | "pause"
  | "withdraw"
  | "limits"
  | "monthly"
  | "register";

/** validation:true = the wallet popup never opened; show `msg` inline at the form. */
export interface ActionOutcome {
  ok: boolean;
  msg: string;
  hash?: string;
  validation?: boolean;
}

/** The optional parts of a one-signature setup; every field is raw form text. */
export interface DeployExtras {
  payee?: string;
  agentKey?: string;
  capXlm?: string;
  hours?: string;
  fundXlm?: string;
  /** What the treasury holds. USDC opens empty and is deposited from the wallet afterwards;
   *  the setup call moves XLM only. XLM when left out. */
  token?: TokenCode;
  /** The salt the form drew when it opened; it fixes the treasury's address, which an agent
   *  connected during setup was already given. A fresh one is drawn when left out. */
  salt?: Buffer;
}

export interface TreasuryContextValue {
  address: string | null;
  treasuryId: string | null;
  state: EunomiaState | null;
  /** The label for every amount on the open treasury: the token it holds. */
  tokenCode: TokenCode;
  lifecycle: Lifecycle | null;
  legacy: boolean;
  sessionActive: boolean;
  walletXlm: number | null | undefined;
  loading: boolean;
  busy: Busy;
  refreshKey: number;
  treasuries: TreasuryRef[];
  refresh: (opts?: { markLoading?: boolean }) => Promise<void>;
  connect: () => Promise<void>;
  /** One signature: deploy + policy + first payee + Leash + funding + registry. */
  deploy: (daily: string, perTask: string, extra?: DeployExtras) => Promise<ActionOutcome>;
  openExisting: (id: string) => ActionOutcome;
  fund: (amount: string) => Promise<ActionOutcome>;
  whitelist: (payeeAddr: string) => Promise<ActionOutcome>;
  removePayeeAddr: (payeeAddr: string) => Promise<ActionOutcome>;
  spend: (to: string, amount: string) => Promise<ActionOutcome>;
  /** Authorise the agent's own key (printed by `eunomia-mcp init`) — the eunomia-mcp
   *  handshake. Refused without one: nothing is generated in the browser. */
  startLeash: (cap: string, hours: string, agentPublicKey?: string) => Promise<ActionOutcome>;
  /** Connect an agent from one button: open its account, approve it (and, when asked, the
   *  service catalog) as payees, start its Leash — each a signature, only the missing ones. */
  connectAgent: (
    cap: string,
    hours: string,
    agentPublicKey: string,
    opts: { catalog: boolean },
    onSteps: (steps: SetupStep[]) => void,
  ) => Promise<ActionOutcome>;
  revokeLeash: () => Promise<ActionOutcome>;
  /** Start a task budget an agent asked for (a verified budget request link). */
  approveBudget: (r: BudgetRequest) => Promise<ActionOutcome>;
  /** v4: the monthly budget ("" or "0" removes it). */
  updateMonthly: (limit: string) => Promise<ActionOutcome>;
  /** v4: a payee's monthly cap ("" or "0" removes it). */
  capPayee: (payee: string, cap: string) => Promise<ActionOutcome>;
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
