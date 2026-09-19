// The agent's own loop. The product claims an agent spends by itself inside rules it cannot
// lift — but the dashboard only ever showed halves of that claim: one payment behind a
// button, and refusals the owner had to provoke by hand from the Payments page. This runs
// the whole thing in order, signed by the Leash key on this device with no wallet popups:
// a payment the rules allow, a payment they refuse, and the agent asking the owner for an
// exception on the refusal. Pure here — the provider performs the steps, the Agent page
// renders them as each one lands.

export type LoopStepKey = "pay" | "refused" | "request";
/** `refused` is an outcome, not a failure: the contract did its job. `failed` means the
 *  step never got an answer from the chain (RPC trouble, an unfunded key). */
export type LoopStepStatus = "pending" | "running" | "done" | "refused" | "failed";

export interface LoopStep {
  key: LoopStepKey;
  /** What the agent is about to do, in the owner's words. */
  title: string;
  status: LoopStepStatus;
  /** One line of outcome, once the step has landed. */
  detail?: string;
  hash?: string;
}

const TITLES: Record<LoopStepKey, string> = {
  pay: "Pays a payee you approved",
  refused: "Tries an address you never approved",
  request: "Asks you to allow it",
};

export const LOOP_ORDER: LoopStepKey[] = ["pay", "refused", "request"];

export const initialLoop = (): LoopStep[] =>
  LOOP_ORDER.map((key) => ({ key, title: TITLES[key], status: "pending" }));

/** Replace one step and leave the rest untouched — the provider keeps no step state. */
export function withStep(steps: LoopStep[], key: LoopStepKey, patch: Partial<LoopStep>): LoopStep[] {
  return steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

/** Whether a finished run left anything for the owner to do. */
export const loopFiledRequest = (steps: LoopStep[]): boolean =>
  steps.some((s) => s.key === "request" && s.status === "done");

// ---- how much the loop pays -------------------------------------------------------

/** One whole unit of the treasury's token, in stroops — what the loop tries to pay. */
export const ONE_UNIT = 10_000_000n;
/** Under a tenth of a unit the run proves nothing, so it reports the binding rule instead. */
export const MIN_DEMO = 1_000_000n;

export interface Room {
  perTaskLimit: bigint;
  dailyLimit: bigint;
  daySpent: bigint;
  balance: bigint;
  /** What is left of the Leash cap, or null when no session binds the spend. */
  sessionLeft: bigint | null;
}

/** The largest amount the loop can pay that every rule allows — one unit at most. Named
 *  the binding rule on failure, because "it didn't run" is not an answer the owner can act
 *  on. Mirrors pay()'s checks, so a demo payment is never one the contract would refuse. */
export function demoAmount(r: Room): { ok: true; stroops: bigint } | { ok: false; why: string } {
  const dayLeft = r.dailyLimit > r.daySpent ? r.dailyLimit - r.daySpent : 0n;
  const caps: [bigint, string][] = [
    [r.perTaskLimit, "Your per-payment cap"],
    [dayLeft, "What is left of today's limit"],
    [r.balance, "The treasury balance"],
  ];
  if (r.sessionLeft !== null) caps.push([r.sessionLeft, "What is left of the Leash cap"]);
  let stroops = ONE_UNIT;
  let binding = "";
  for (const [cap, name] of caps) {
    if (cap < stroops) {
      stroops = cap;
      binding = name;
    }
  }
  if (stroops < MIN_DEMO) {
    return { ok: false, why: `${binding || "Your rules"} leaves too little to run this — add funds or raise the cap.` };
  }
  return { ok: true, stroops };
}

/** Stroops as the decimal `pay` takes. Exact for the amounts the loop chooses. */
export const unitsOf = (stroops: bigint): number => Number(stroops) / 1e7;
