// Setup progress for the Overview stepper and the Setup wizard: five checkpoints from
// first visit to first payment, computed from live state so it always shows the truth
// (and disappears once complete). Pure and unit-tested.
export type SetupStep = "connect" | "deploy" | "fund" | "whitelist" | "pay";

export interface SetupInputs {
  connected: boolean;
  hasTreasury: boolean;
  balance: bigint | null; // null = not read yet — fund must NOT count as done
  payeeCount: number | null; // null = not derived yet
  hasPaid: boolean;
}

export interface SetupProgress {
  steps: { step: SetupStep; done: boolean }[];
  next: SetupStep | null;
  complete: boolean;
}

const ORDER: readonly SetupStep[] = ["connect", "deploy", "fund", "whitelist", "pay"];

export function setupProgress(i: SetupInputs): SetupProgress {
  const done: Record<SetupStep, boolean> = {
    connect: i.connected,
    deploy: i.hasTreasury,
    fund: (i.balance ?? 0n) > 0n,
    whitelist: (i.payeeCount ?? 0) > 0,
    pay: i.hasPaid,
  };
  const steps = ORDER.map((step) => ({ step, done: done[step] }));
  const next = ORDER.find((s) => !done[s]) ?? null;
  return { steps, next, complete: next === null };
}

// The owner's journey on the Overview page (2026-11-28): the four things that have to be true
// before an agent has bought something, in the order an owner does them. The first builder
// sessions stalled between these — a treasury left empty, an agent connected to nothing —
// because no screen said which one came next.
export type JourneyStep = "open" | "fund" | "agent" | "ask";

export interface JourneyInputs {
  /** null = not read yet: nothing is shown until it is, or the step under the cursor changes */
  balance: bigint | null;
  agentOn: boolean;
  hasPaid: boolean;
}

export interface Journey {
  steps: { step: JourneyStep; done: boolean }[];
  now: JourneyStep | null;
  complete: boolean;
}

const JOURNEY: readonly JourneyStep[] = ["open", "fund", "agent", "ask"];

export function ownerJourney(i: JourneyInputs): Journey | null {
  if (i.balance === null) return null;
  const done: Record<JourneyStep, boolean> = {
    open: true,
    // A treasury that has paid was funded, even if the agent has since spent it all.
    fund: i.balance > 0n || i.hasPaid,
    agent: i.agentOn,
    ask: i.hasPaid,
  };
  const steps = JOURNEY.map((step) => ({ step, done: done[step] }));
  const now = JOURNEY.find((s) => !done[s]) ?? null;
  return { steps, now, complete: now === null };
}
