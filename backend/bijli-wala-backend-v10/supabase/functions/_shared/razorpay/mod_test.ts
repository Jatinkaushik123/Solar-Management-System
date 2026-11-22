import { createRazorpayGateway, RazorpayError } from "./mod.ts";

const CONFIG = {
  keyId: "rzp_test_example",
  keySecret: "unit-test-key-secret",
  webhookSecret: "unit-test-webhook-secret",
};

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function assertRejectsCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof RazorpayError)) {
      throw new Error("Expected a RazorpayError");
    }
    assertEquals(error.code, code);
    return;
  }
  throw new Error(`Expected rejection with code ${code}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function payment(
  overrides: Partial<
    {
      id: string;
      order_id: string | null;
      amount: number;
      currency: string;
      status: string;
    }
  > = {},
): Record<string, unknown> {
  return {
    id: "pay_fixture123",
    order_id: "order_fixture123",
    amount: 3_300_000,
    currency: "INR",
    status: "captured",
    ...overrides,
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function hmacHex(secret: string, bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, arrayBuffer(bytes))),
  );
}

function webhookBytes(event: string, entity: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    entity: "event",
    event,
    payload: { payment: { entity } },
  }));
}

Deno.test("createOrder sends exact INR amount and checkout reference", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const gateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({
        id: "order_fixture123",
        amount: 16_500_000,
        currency: "INR",
      });
    },
  });

  const result = await gateway.createOrder({
    checkoutRef: "attempt_01",
    amountPaise: 16_500_000,
  });

  assertEquals(result, {
    keyId: CONFIG.keyId,
    orderId: "order_fixture123",
    amountPaise: 16_500_000,
    currency: "INR",
  });
  assertEquals(requestUrl, "https://api.razorpay.com/v1/orders");
  assertEquals(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assertEquals(
    headers.get("authorization"),
    `Basic ${btoa(`${CONFIG.keyId}:${CONFIG.keySecret}`)}`,
  );
  assertEquals(headers.get("content-type"), "application/json");
  assertEquals(JSON.parse(String(requestInit?.body)), {
    amount: 16_500_000,
    currency: "INR",
    receipt: "attempt_01",
  });
});

Deno.test("createOrder rejects invalid amounts and non-ASCII or oversized references without fetching", async () => {
  let calls = 0;
  const gateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () => {
      calls++;
      return jsonResponse({});
    },
  });

  for (
    const amountPaise of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]
  ) {
    await assertRejectsCode(
      () => gateway.createOrder({ checkoutRef: "attempt_01", amountPaise }),
      "invalid_input",
    );
  }
  for (const checkoutRef of ["", "a".repeat(41), "ref-☀", "line\nbreak"]) {
    await assertRejectsCode(
      () => gateway.createOrder({ checkoutRef, amountPaise: 100 }),
      "invalid_input",
    );
  }
  assertEquals(calls, 0);
});

Deno.test("createOrder rejects malformed or mismatched provider order responses", async () => {
  const responses = [
    { id: "not-an-order", amount: 100, currency: "INR" },
    { id: "order_fixture123", amount: 101, currency: "INR" },
    { id: "order_fixture123", amount: 100, currency: "USD" },
  ];
  for (const body of responses) {
    const gateway = createRazorpayGateway({
      ...CONFIG,
      fetchImpl: async () => jsonResponse(body),
    });
    await assertRejectsCode(
      () =>
        gateway.createOrder({ checkoutRef: "attempt_01", amountPaise: 100 }),
      "provider_unavailable",
    );
  }
  const invalidJsonGateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () => new Response("{", { status: 200 }),
  });
  await assertRejectsCode(
    () =>
      invalidJsonGateway.createOrder({
        checkoutRef: "attempt_01",
        amountPaise: 100,
      }),
    "provider_unavailable",
  );
});

Deno.test("createOrder times out once without automatic retry", async () => {
  let calls = 0;
  const gateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: (_input, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("Missing timeout signal"));
        if (signal.aborted) {
          return reject(new DOMException("Aborted", "AbortError"));
        }
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
  });

  await assertRejectsCode(
    () =>
      gateway.createOrder({ checkoutRef: "attempt_timeout", amountPaise: 100 }),
    "provider_unavailable",
  );
  assertEquals(calls, 1);
});

Deno.test("verifyCheckout authenticates only the signature for the stored order", async () => {
  const gateway = createRazorpayGateway(CONFIG);
  const valid = await hmacHex(
    CONFIG.keySecret,
    new TextEncoder().encode("order_fixture123|pay_fixture123"),
  );

  assert(
    await gateway.verifyCheckout({
      storedOrderId: "order_fixture123",
      paymentId: "pay_fixture123",
      signature: valid,
    }),
  );
  assert(
    !await gateway.verifyCheckout({
      storedOrderId: "order_another123",
      paymentId: "pay_fixture123",
      signature: valid,
    }),
  );
  assert(
    !await gateway.verifyCheckout({
      storedOrderId: "order_fixture123",
      paymentId: "pay_fixture123",
      signature: "xyz",
    }),
  );
});

Deno.test("verifyWebhook validates unchanged raw bytes and rejects a one-byte change or wrong secret", async () => {
  const bytes = webhookBytes("payment.captured", payment());
  const signature = await hmacHex(CONFIG.webhookSecret, bytes);
  const gateway = createRazorpayGateway(CONFIG);
  const result = await gateway.verifyWebhook({
    rawBody: bytes,
    signature,
    eventId: "evt_fixture123",
  });
  assertEquals(result, {
    kind: "payment",
    eventId: "evt_fixture123",
    eventType: "payment.captured",
    payment: {
      paymentId: "pay_fixture123",
      orderId: "order_fixture123",
      amountPaise: 3_300_000,
      currency: "INR",
      status: "captured",
    },
  });

  const changed = bytes.slice();
  changed[changed.length - 1] ^= 1;
  await assertRejectsCode(
    () =>
      gateway.verifyWebhook({
        rawBody: changed,
        signature,
        eventId: "evt_fixture123",
      }),
    "invalid_signature",
  );
  const wrongSecretGateway = createRazorpayGateway({
    ...CONFIG,
    webhookSecret: "wrong-secret",
  });
  await assertRejectsCode(
    () =>
      wrongSecretGateway.verifyWebhook({
        rawBody: bytes,
        signature,
        eventId: "evt_fixture123",
      }),
    "invalid_signature",
  );
});

Deno.test("verifyWebhook rejects missing event IDs and signed malformed payloads", async () => {
  const gateway = createRazorpayGateway(CONFIG);
  const bytes = webhookBytes("payment.captured", payment());
  const signature = await hmacHex(CONFIG.webhookSecret, bytes);
  await assertRejectsCode(
    () => gateway.verifyWebhook({ rawBody: bytes, signature, eventId: " " }),
    "invalid_input",
  );

  const invalidJson = new TextEncoder().encode("{");
  const invalidJsonSignature = await hmacHex(CONFIG.webhookSecret, invalidJson);
  await assertRejectsCode(
    () =>
      gateway.verifyWebhook({
        rawBody: invalidJson,
        signature: invalidJsonSignature,
        eventId: "evt_bad_json",
      }),
    "invalid_payload",
  );

  const missingDetails = new TextEncoder().encode(
    JSON.stringify({ event: "payment.failed" }),
  );
  const missingDetailsSignature = await hmacHex(
    CONFIG.webhookSecret,
    missingDetails,
  );
  await assertRejectsCode(
    () =>
      gateway.verifyWebhook({
        rawBody: missingDetails,
        signature: missingDetailsSignature,
        eventId: "evt_missing_payment",
      }),
    "invalid_payload",
  );
});

Deno.test("verifyWebhook preserves event IDs on repeats and reports provider event status", async () => {
  const gateway = createRazorpayGateway(CONFIG);
  const capturedBytes = webhookBytes(
    "payment.captured",
    payment({ status: "captured" }),
  );
  const capturedSignature = await hmacHex(CONFIG.webhookSecret, capturedBytes);
  const input = {
    rawBody: capturedBytes,
    signature: capturedSignature,
    eventId: "evt_replay123",
  };
  const first = await gateway.verifyWebhook(input);
  const second = await gateway.verifyWebhook(input);
  assertEquals(first, second);
  assertEquals(first.eventId, "evt_replay123");
  if (first.kind === "payment") {
    assertEquals(first.payment.paymentId, "pay_fixture123");
    assertEquals(first.payment.status, "captured");
  } else {
    throw new Error("Expected captured payment event");
  }

  const authorizedBytes = webhookBytes(
    "payment.authorized",
    payment({ status: "authorized" }),
  );
  const authorizedSignature = await hmacHex(
    CONFIG.webhookSecret,
    authorizedBytes,
  );
  const authorized = await gateway.verifyWebhook({
    rawBody: authorizedBytes,
    signature: authorizedSignature,
    eventId: "evt_late_auth123",
  });
  assert(authorized.kind === "payment");
  assertEquals(authorized.payment.status, "authorized");
});

Deno.test("verifyWebhook returns ignored for a correctly signed unhandled event", async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ event: "refund.created", payload: {} }),
  );
  const signature = await hmacHex(CONFIG.webhookSecret, bytes);
  const result = await createRazorpayGateway(CONFIG).verifyWebhook({
    rawBody: bytes,
    signature,
    eventId: "evt_ignored123",
  });
  assertEquals(result, {
    kind: "ignored",
    eventId: "evt_ignored123",
    eventType: "refund.created",
  });
});

Deno.test("verifyWebhook normalizes a failed payment event", async () => {
  const bytes = webhookBytes("payment.failed", payment({ status: "failed" }));
  const result = await createRazorpayGateway(CONFIG).verifyWebhook({
    rawBody: bytes,
    signature: await hmacHex(CONFIG.webhookSecret, bytes),
    eventId: "evt_failed123",
  });
  assert(result.kind === "payment");
  assertEquals(result.eventType, "payment.failed");
  assertEquals(result.payment.status, "failed");
});

Deno.test("mocked successful and failed checkout journeys keep provider status visible", async () => {
  for (const status of ["captured", "failed"] as const) {
    let calls = 0;
    const gateway = createRazorpayGateway({
      ...CONFIG,
      fetchImpl: async (input) => {
        calls++;
        if (String(input) === "https://api.razorpay.com/v1/orders") {
          return jsonResponse({
            id: "order_fixture123",
            amount: 3_300_000,
            currency: "INR",
          });
        }
        return jsonResponse(payment({ status }));
      },
    });
    const checkout = await gateway.createOrder({
      checkoutRef: `attempt_${status}`,
      amountPaise: 3_300_000,
    });
    const signature = await hmacHex(
      CONFIG.keySecret,
      new TextEncoder().encode(`${checkout.orderId}|pay_fixture123`),
    );
    assert(
      await gateway.verifyCheckout({
        storedOrderId: checkout.orderId,
        paymentId: "pay_fixture123",
        signature,
      }),
    );
    const fetched = await gateway.fetchPayment("pay_fixture123");
    assertEquals(fetched.status, status);
    assertEquals(fetched.amountPaise, 3_300_000);
    assertEquals(checkout.currency, "INR");
    assertEquals(calls, 2);
  }
});

Deno.test("fetchPayment normalizes authorized, captured, and failed payment fixtures", async () => {
  const fixtures = ["authorized", "captured", "failed"];
  for (const status of fixtures) {
    const gateway = createRazorpayGateway({
      ...CONFIG,
      fetchImpl: async () => jsonResponse(payment({ status })),
    });
    const result = await gateway.fetchPayment("pay_fixture123");
    assertEquals(result, {
      paymentId: "pay_fixture123",
      orderId: "order_fixture123",
      amountPaise: 3_300_000,
      currency: "INR",
      status,
    });
  }
});

Deno.test("fetchPayment keeps a missing order null", async () => {
  const gateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () => jsonResponse(payment({ order_id: null })),
  });
  const result = await gateway.fetchPayment("pay_fixture123");
  assertEquals(result.orderId, null);
});

Deno.test("fetchPayment keeps mismatched order and currency visible", async () => {
  const gateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () =>
      jsonResponse(
        payment({ order_id: "order_unrelated123", currency: "USD" }),
      ),
  });
  const result = await gateway.fetchPayment("pay_fixture123");
  assertEquals(result.orderId, "order_unrelated123");
  assertEquals(result.currency, "USD");
});

Deno.test("fetchPayment sanitizes provider and network failures", async () => {
  const failedResponseGateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () =>
      new Response("private provider details", { status: 400 }),
  });
  await assertRejectsCode(
    () => failedResponseGateway.fetchPayment("pay_fixture123"),
    "provider_error",
  );

  const unavailableGateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () =>
      new Response("private provider details", { status: 502 }),
  });
  await assertRejectsCode(
    () => unavailableGateway.fetchPayment("pay_fixture123"),
    "provider_unavailable",
  );

  const networkFailureGateway = createRazorpayGateway({
    ...CONFIG,
    fetchImpl: async () => {
      throw new Error("secret-bearing network detail");
    },
  });
  try {
    await networkFailureGateway.fetchPayment("pay_fixture123");
    throw new Error("Expected provider failure");
  } catch (error) {
    if (!(error instanceof RazorpayError)) {
      throw new Error("Expected a RazorpayError");
    }
    assertEquals(error.code, "provider_unavailable");
    assert(!error.message.includes("secret-bearing"));
  }
});

Deno.test("configuration rejects a live or malformed key ID", () => {
  for (const keyId of ["rzp_live_private", "rzp_test_", "not-a-razorpay-key"]) {
    try {
      createRazorpayGateway({ ...CONFIG, keyId });
      throw new Error("Expected invalid key ID to fail");
    } catch (error) {
      if (!(error instanceof RazorpayError)) {
        throw new Error("Expected a RazorpayError");
      }
      assertEquals(error.code, "invalid_input");
    }
  }
});
