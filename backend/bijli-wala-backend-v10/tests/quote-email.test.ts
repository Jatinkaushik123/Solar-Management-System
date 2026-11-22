import { configuredQuoteEmail, handleQuoteEmail, sendQuoteEmail } from "../supabase/functions/api/quote-email.ts";

function expect(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Unexpected result");
}

const env = new Map([
  ["RESEND_API_KEY", "re_unit_test"],
  ["QUOTE_EMAIL_FROM", "SunPower Test <noreply@unit.test>"],
  ["QUOTE_PORTAL_URL", "https://portal.unit.test/quotes/open"],
]);
const config = configuredQuoteEmail(env.get.bind(env))!;
const request = () => new Request("https://unit.test/v1/jobs/quote-email", {
  method: "POST", headers: { Authorization: "Bearer " + "a".repeat(64) },
});

Deno.test("an unconfigured sender checks worker authorization and claims nothing", async () => {
  const result = await handleQuoteEmail(request(), (name, args) => {
    expect(name, "solar_quote_emails_claim");
    expect(args.ready, false);
    return Promise.resolve([]);
  }, null, () => Promise.reject(new Error("Unexpected provider call")));
  expect(result.ready, false);
  expect(result.claimed, 0);
  expect(configuredQuoteEmail(key => key === "QUOTE_PORTAL_URL" ? "http://portal.unit.test" : env.get(key)), null);
  expect(configuredQuoteEmail(key => key === "QUOTE_EMAIL_TEST_RECIPIENT" ? "demo@invalid.test" : env.get(key)), null);
});

Deno.test("the same outbox id and frozen request survive a lost provider response and config changes", async () => {
  const quote = crypto.randomUUID(), id = crypto.randomUUID(), providerId = crypto.randomUUID();
  let saved: { from: string; to: string; subject: string; text: string } | null = null;
  let lease = crypto.randomUUID();
  const calls: { key: string | null; body: string }[] = [];
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name === "solar_quote_emails_claim") return Promise.resolve([{
      id, quote_id: quote, lease_id: lease, recipient: "buyer@unit.test", provider_request: saved,
      message: { quote_id: quote, quote_revision: 2, request_reference: "ENQ-42", valid_until: "2026-12-31",
        total_paise: 16500000, advance_paise: 3300000, discount_paise: 0, installation_paise: 0,
        lines: [{ item_id: "DEMO-INVERTER", name: "Demo inverter", quantity: 1, unit_paise: 16500000 }] },
    }]);
    expect(args.lease, lease);
    expect(args.target, id);
    if (name === "solar_quote_email_prepare") {
      saved ??= args.payload as NonNullable<typeof saved>;
      return Promise.resolve(saved);
    }
    expect(name, "solar_quote_email_finish");
    expect(args.outcome, calls.length === 1 ? "retry" : "accepted");
    return Promise.resolve(true);
  };
  const fetcher: typeof fetch = (url, init) => {
    expect(String(url), "https://api.resend.com/emails");
    calls.push({key: new Headers(init?.headers).get("idempotency-key"), body: String(init?.body)});
    // Simulate provider acceptance followed by a lost first response.
    return calls.length === 1 ? Promise.reject(new Error("connection lost")) : Promise.resolve(Response.json({id:providerId}));
  };
  expect((await handleQuoteEmail(request(), rpc, config, fetcher)).retrying, 1);
  lease = crypto.randomUUID();
  const newConfig = { ...config, from: "Changed <name@unit.test>", portalUrl: new URL("https://changed.unit.test/") };
  expect((await handleQuoteEmail(request(), rpc, newConfig, fetcher)).accepted, 1);
  expect(calls[0].key, "quote-email/" + id);
  expect(calls[1], calls[0]);
  const body = JSON.parse(calls[1].body);
  expect(body.text.includes("https://portal.unit.test/quotes/open?quote_id=" + quote), true);
  expect(body.text.includes("₹1,65,000.00"), true);
});

Deno.test("rate limits, server errors and conflicts are classified without provider details", async () => {
  const payload = { from: config.from, to: "buyer@unit.test", subject: "Quote", text: "Hello" };
  for (const [status, name, outcome, reason] of [
    [429, "rate_limit_exceeded", "retry", "provider_rate_limited"],
    [503, "application_error", "retry", "provider_unavailable"],
    [409, "concurrent_idempotent_requests", "retry", "provider_idempotency_pending"],
    [409, "invalid_idempotent_request", "terminal", "provider_idempotency_conflict"],
    [403, "invalid_api_key", "terminal", "provider_rejected"],
  ] as const) {
    const result = await sendQuoteEmail(config, crypto.randomUUID(), payload,
      () => Promise.resolve(Response.json({name, message:"Provider details"}, {status})));
    expect(result, {outcome, provider_id:null, reason});
  }
});
