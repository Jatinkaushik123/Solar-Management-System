import { ApiError, uuid } from "./http.ts";

type Message = {
  quote_id: string;
  quote_revision: number;
  request_reference: string;
  valid_until: string;
  total_paise: number;
  advance_paise: number;
  discount_paise: number;
  installation_paise: number;
  lines: { item_id: string; name: string; quantity: number; unit_paise: number }[];
};
type Payload = { from: string; to: string; subject: string; text: string };
type Claim = { id: string; quote_id: string; recipient: string; message: Message; lease_id: string; provider_request: Payload | null };
type QuoteEmailConfig = { apiKey: string; from: string; portalUrl: URL; testRecipient: string | null };
type SendResult =
  | { outcome: "accepted"; provider_id: string; reason: null }
  | { outcome: "retry" | "terminal"; provider_id: null; reason: string };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function deliverable(address: string) {
  const domain = address.split("@")[1] ?? "";
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(address) &&
    !/(^|\.)(test|invalid|example|localhost)$|(^|\.)example\.(com|net|org)$/i.test(domain);
}

export function configuredQuoteEmail(env: (key: string) => string | undefined): QuoteEmailConfig | null {
  const apiKey = env("RESEND_API_KEY")?.trim();
  const from = env("QUOTE_EMAIL_FROM")?.trim();
  const testRecipient = env("QUOTE_EMAIL_TEST_RECIPIENT")?.trim().toLowerCase() ?? null;
  const url = env("QUOTE_PORTAL_URL")?.trim();
  if (!apiKey || !apiKey.startsWith("re_") || !from || !from.includes("@") || /[\r\n]/.test(from) || !url ||
      (testRecipient !== null && !deliverable(testRecipient))) return null;
  try {
    const portalUrl = new URL(url);
    if (portalUrl.protocol !== "https:" || portalUrl.username || portalUrl.password || portalUrl.hash) return null;
    return { apiKey, from, portalUrl, testRecipient };
  } catch {
    return null;
  }
}

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function rupees(paise: number) {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("Invalid quote amount");
  return money.format(paise / 100);
}

function quoteEmail(job: Claim, config: QuoteEmailConfig): Payload {
  const m = job.message;
  if (m.quote_id !== job.quote_id || !uuid.test(job.quote_id) || !/^ENQ-\d+$/.test(m.request_reference) ||
      !Number.isInteger(m.quote_revision) || !Array.isArray(m.lines) || !/^\d{4}-\d{2}-\d{2}$/.test(m.valid_until)) {
    throw new Error("Invalid quote snapshot");
  }
  const link = new URL(config.portalUrl);
  link.searchParams.set("quote_id", job.quote_id);
  const lines = m.lines.map(line => `• ${line.name || line.item_id} × ${line.quantity} at ${rupees(line.unit_paise)} each`);
  return {
    from: config.from,
    to: job.recipient,
    subject: `SunPower Solutions quotation for ${m.request_reference}`,
    text: [
      `Your solar quotation for ${m.request_reference} (revision ${m.quote_revision}) is ready.`, "",
      ...lines, "",
      `Installation: ${rupees(m.installation_paise)}`,
      `Discount: ${rupees(m.discount_paise)}`,
      `Quotation total: ${rupees(m.total_paise)}`,
      `Advance: ${rupees(m.advance_paise)}`,
      `Valid through ${m.valid_until} (India time).`, "",
      "Open your quote and sign in with the account used for the enquiry:", link.href,
    ].join("\n"),
  };
}

const retry = (reason: string): SendResult => ({ outcome: "retry", provider_id: null, reason });
const terminal = (reason: string): SendResult => ({ outcome: "terminal", provider_id: null, reason });

export async function sendQuoteEmail(config: QuoteEmailConfig, id: string, payload: Payload, fetcher = fetch): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "quote-email/" + id,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return retry("network_error");
  }
  if (response.status === 429) return retry("provider_rate_limited");
  if (response.status >= 500 || response.status === 408) return retry("provider_unavailable");
  if (response.status === 409) {
    const error = await response.json().catch(() => null);
    return error?.name === "concurrent_idempotent_requests" ? retry("provider_idempotency_pending")
      : terminal("provider_idempotency_conflict");
  }
  if (!response.ok) return terminal("provider_rejected");
  const result = await response.json().catch(() => null);
  return typeof result?.id === "string" && uuid.test(result.id)
    ? { outcome: "accepted", provider_id: result.id, reason: null }
    : retry("provider_unavailable");
}

export async function handleQuoteEmail(req: Request, rpc: Rpc, config: QuoteEmailConfig | null, fetcher = fetch) {
  if (req.method !== "POST") throw new ApiError(405, "method_not_allowed");
  const ticket = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("Authorization") ?? "")?.[1];
  if (!ticket) throw new ApiError(403, "forbidden");
  const jobs = await rpc("solar_quote_emails_claim", { ticket, ready: config !== null, recipient_filter: config?.testRecipient ?? null }) as Claim[];
  if (!config) return { ready: false, claimed: 0, accepted: 0, retrying: 0, needs_attention: 0, deferred: 0 };
  const settled = await Promise.allSettled(jobs.map(async job => {
    const target = { ticket, target: job.id, lease: job.lease_id };
    let payload: Payload;
    try {
      payload = job.provider_request ?? quoteEmail(job, config);
    } catch {
      const updated = await rpc("solar_quote_email_finish", { ...target, ...terminal("invalid_message") });
      return updated ? "terminal" : "deferred";
    }
    const frozen = await rpc("solar_quote_email_prepare", { ...target, payload }) as Payload | null;
    if (!frozen) return "deferred";
    const result = await sendQuoteEmail(config, job.id, frozen, fetcher);
    const updated = await rpc("solar_quote_email_finish", { ...target, ...result });
    return updated ? result.outcome : "deferred";
  }));
  return {
    ready: true,
    claimed: jobs.length,
    accepted: settled.filter(job => job.status === "fulfilled" && job.value === "accepted").length,
    retrying: settled.filter(job => job.status === "fulfilled" && job.value === "retry").length,
    needs_attention: settled.filter(job => job.status === "fulfilled" && job.value === "terminal").length,
    deferred: settled.filter(job => job.status === "rejected" || job.value === "deferred").length,
  };
}
