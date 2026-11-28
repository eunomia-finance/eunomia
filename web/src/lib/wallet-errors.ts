// Wallet error classification — pure functions, so they're unit-testable. Map raw
// wallet/SDK errors into the three surfaced error types: wallet not installed,
// request rejected, and insufficient balance.
import { tx } from "./i18n";

export function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return typeof e === "string" ? e : "";
}

/** connect: wallet not installed (type 1) or request rejected (type 2). */
export function connectErr(e: unknown): string {
  const m = errText(e).toLowerCase();
  if (m.includes("not available") || m.includes("not installed") || m.includes("install")) {
    return tx("That wallet isn't installed — pick another option.", "Bu cüzdan kurulu değil — başka bir seçenek seç.");
  }
  if (
    m.includes("reject") || m.includes("denied") || m.includes("declin") ||
    m.includes("close") || m.includes("cancel")
  ) {
    return tx("Connection cancelled.", "Bağlantı iptal edildi.");
  }
  return errText(e) || tx("Couldn't connect a wallet.", "Cüzdan bağlanamadı.");
}

/** The user-facing text for a wallet session the wallet no longer honours. */
export const STALE_SESSION_MSG =
  "Wallet connection expired — reconnect your wallet and try again.";

/** The same sentence in the current language (the constant above stays English). */
export const staleSessionMsg = (): string =>
  tx(STALE_SESSION_MSG, "Cüzdan bağlantısının süresi doldu — cüzdanını yeniden bağla, sonra tekrar dene.");

/** A WalletConnect session the wallet dropped (deleted, expired or never paired). The app
 *  keeps signing against a topic that no longer exists, so nothing ever opens on the phone.
 *  Detected here so callers can clear the session instead of showing the raw core error. */
export function isStaleSessionError(e: unknown): boolean {
  const m = errText(e).toLowerCase();
  if (!m.includes("session")) return false;
  return (
    m.includes("recently deleted") ||
    m.includes("no matching key") ||
    m.includes("missing or invalid") ||
    m.includes("expired")
  );
}

/** send: insufficient balance (type 3) or signature rejected (type 2). */
export function sendErr(e: unknown): string {
  if (isStaleSessionError(e)) return staleSessionMsg();
  const codes = (e as {
    response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string } } } };
  })?.response?.data?.extras?.result_codes;
  const opCodes = codes?.operations?.join(", ") || codes?.transaction || "";
  if (opCodes.includes("underfunded") || opCodes.toLowerCase().includes("insufficient")) {
    return tx("Insufficient balance for this payment.", "Bu ödeme için bakiye yetersiz.");
  }
  const m = errText(e).toLowerCase();
  if (m.includes("account not found") || m.includes("account does not exist")) {
    return tx("Your wallet has no XLM yet — send some XLM to it first.", "Cüzdanında henüz XLM yok — önce biraz XLM gönder.");
  }
  if (m.includes("underfunded") || m.includes("insufficient balance")) {
    return tx("Insufficient balance for this payment.", "Bu ödeme için bakiye yetersiz.");
  }
  if (m.includes("reject") || m.includes("denied") || m.includes("declin") || m.includes("cancel")) {
    return tx("Signature rejected in your wallet.", "İmzayı cüzdanda reddettin.");
  }
  return opCodes || errText(e) || tx("Transaction failed.", "İşlem başarısız oldu.");
}

/** On-chain policy rejections (`Error(Contract, #N)`) → human-readable messages.
 *  A rejection is the product working — these read as guardrails, not failures. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: "Amount must be greater than zero.",
  2: "Payee isn't approved — not on the whitelist.",
  3: "Over the per-task limit — the payment never left the treasury.",
  4: "Over today's daily limit — the payment never left the treasury.",
  5: "Payee's reputation score is below the required threshold.",
  6: "Not enough free balance — funds are locked in open escrows.",
  7: "Escrow not found — it may already be released or refunded.",
  8: "Escrow deadline hasn't passed yet — refund isn't available.",
  9: "Treasury is paused — spending is temporarily frozen by the owner.",
  10: "Over the agent session's spending cap — the payment never left the treasury.",
  11: "Invalid limits — both must be positive and per-payment can't exceed daily.",
  12: "Escrow deadline must be in the future.",
  13: "The payee can't hold this token yet — their account needs a trustline first.",
  14: "Over this payee's monthly cap — the payment never left the treasury.",
  15: "Over this month's budget — the payment never left the treasury.",
  16: "That would take the treasury over its deposit cap — this beta holds a limited amount per treasury.",
  17: "Outside the task budget — this agent may only pay the payees the owner approved for the task.",
};

/** Turkish for CONTRACT_ERRORS, code for code. */
const CONTRACT_ERRORS_TR: Record<number, string> = {
  1: "Tutar sıfırdan büyük olmalı.",
  2: "Alıcı onaylı değil — izin listesinde yok.",
  3: "Tek ödeme sınırı aşıldı — ödeme kasadan hiç çıkmadı.",
  4: "Bugünkü günlük sınır aşıldı — ödeme kasadan hiç çıkmadı.",
  5: "Alıcının itibar puanı gereken eşiğin altında.",
  6: "Serbest bakiye yetmiyor — para açık emanetlerde kilitli.",
  7: "Emanet bulunamadı — zaten bırakılmış ya da iade edilmiş olabilir.",
  8: "Emanetin son tarihi daha geçmedi — iade henüz yapılamaz.",
  9: "Kasa durdurulmuş — sahibi harcamayı geçici olarak dondurdu.",
  10: "Ajanın yetki tavanı aşıldı — ödeme kasadan hiç çıkmadı.",
  11: "Geçersiz sınırlar — ikisi de pozitif olmalı, tek ödeme günlüğü geçemez.",
  12: "Emanetin son tarihi gelecekte olmalı.",
  13: "Alıcı bu tokeni henüz tutamıyor — hesabına önce bir trustline lazım.",
  14: "Bu alıcının aylık tavanı aşıldı — ödeme kasadan hiç çıkmadı.",
  15: "Bu ayın bütçesi aşıldı — ödeme kasadan hiç çıkmadı.",
  16: "Kasa mevcut tavanı aşardı — bu beta her kasada sınırlı tutar tutuyor.",
  17: "Görev bütçesinin dışında — ajan yalnız sahibinin görev için onayladığı alıcılara ödeme yapabilir.",
};

/** A contract rejection's text in the current language; undefined for an unknown code. */
export function contractMsg(code: number): string | undefined {
  const en = CONTRACT_ERRORS[code];
  return en === undefined ? undefined : tx(en, CONTRACT_ERRORS_TR[code] ?? en);
}

/** Parse a contract guardrail rejection out of a raw error message. Returns null
 *  when the failure isn't a contract error, so callers' retry logic stays intact. */
export function contractErr(msg: string): { errorCode: number; errorMessage: string } | null {
  const m = msg.match(/Error\(Contract,\s*#?(\d+)\)/);
  if (!m) return null;
  const code = Number(m[1]);
  return { errorCode: code, errorMessage: contractMsg(code) ?? tx(`Contract error #${code}`, `Sözleşme hatası #${code}`) };
}

/** A failed `deposit`, worded for the person depositing. The treasury itself only refuses a
 *  deposit with 1 or 16; every other code came from the token it moves, and the token's
 *  codes overlap the treasury's — the SAC's #10 is a short balance, not a session cap. */
export function depositErr(msg: string, unit: string): string | null {
  const ce = contractErr(msg);
  if (!ce) return null;
  if (ce.errorCode === 1 || ce.errorCode === 16) return ce.errorMessage;
  if (ce.errorCode === 10) return tx(`Your wallet doesn't hold that much ${unit}.`, `Cüzdanında o kadar ${unit} yok.`);
  if (ce.errorCode === 13) return tx(
      `Your wallet can't hold ${unit} yet — it needs a ${unit} trustline first.`,
      `Cüzdanın henüz ${unit} tutamıyor — önce bir ${unit} trustline lazım.`,
    );
  return tx(`The ${unit} token refused the deposit (#${ce.errorCode}).`, `${unit} tokeni yatırmayı reddetti (#${ce.errorCode}).`);
}
