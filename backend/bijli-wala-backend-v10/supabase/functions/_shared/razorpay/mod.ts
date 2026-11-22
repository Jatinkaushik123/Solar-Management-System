export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
}

export interface CheckoutOrder {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
}

export interface PaymentSnapshot {
  paymentId: string;
  orderId: string | null;
  amountPaise: number;
  currency: string;
  status: string;
}

export type VerifiedEvent =
  | {
    kind: "payment";
    eventId: string;
    eventType: string;
    payment: PaymentSnapshot;
  }
  | { kind: "ignored"; eventId: string; eventType: string };

export type RazorpayErrorCode =
  | "invalid_input"
  | "invalid_signature"
  | "invalid_payload"
  | "provider_error"
  | "provider_unavailable";

export class RazorpayError extends Error {
  readonly code: RazorpayErrorCode;

  constructor(code: RazorpayErrorCode, message: string) {
    super(message);
    this.name = "RazorpayError";
    this.code = code;
  }
}

export interface RazorpayGateway {
  createOrder(input: {
    checkoutRef: string;
    amountPaise: number;
  }): Promise<CheckoutOrder>;

  verifyCheckout(input: {
    storedOrderId: string;
    paymentId: string;
    signature: string;
  }): Promise<boolean>;

  verifyWebhook(input: {
    rawBody: Uint8Array;
    signature: string;
    eventId: string;
  }): Promise<VerifiedEvent>;

  fetchPayment(paymentId: string): Promise<PaymentSnapshot>;
}

const API_BASE = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const HEX_SIGNATURE = /^[\da-f]{64}$/i;
const ORDER_ID = /^order_[A-Za-z0-9]+$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function decodeHex(value: string): Uint8Array | null {
  if (!HEX_SIGNATURE.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function verifyHmac(
  secret: string,
  signature: string,
  data: Uint8Array,
): Promise<boolean> {
  const signatureBytes = decodeHex(signature);
  if (!signatureBytes) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      asArrayBuffer(signatureBytes),
      asArrayBuffer(data),
    );
  } catch {
    return false;
  }
}

function validatePaymentSnapshot(value: unknown): PaymentSnapshot | null {
  if (!isRecord(value)) return null;
  const orderValue = value.order_id;
  if (
    orderValue !== undefined && orderValue !== null &&
    (!requiredString(orderValue) || !ORDER_ID.test(orderValue))
  ) return null;
  if (
    !requiredString(value.id) || !PAYMENT_ID.test(value.id) ||
    !Number.isSafeInteger(value.amount) || (value.amount as number) <= 0 ||
    !requiredString(value.currency) ||
    !requiredString(value.status)
  ) return null;

  return {
    paymentId: value.id,
    orderId: typeof orderValue === "string" ? orderValue : null,
    amountPaise: value.amount as number,
    currency: value.currency,
    status: value.status,
  };
}

function providerError(message: string): RazorpayError {
  return new RazorpayError("provider_error", message);
}

export function createRazorpayGateway(config: RazorpayConfig): RazorpayGateway {
  if (!config || typeof config !== "object") {
    throw new RazorpayError(
      "invalid_input",
      "Razorpay configuration is required.",
    );
  }
  if (
    typeof config.keyId !== "string" ||
    !/^rzp_test_[A-Za-z0-9]+$/.test(config.keyId)
  ) {
    throw new RazorpayError(
      "invalid_input",
      "A valid Razorpay Test Mode key ID is required.",
    );
  }
  if (
    !requiredString(config.keySecret) || !requiredString(config.webhookSecret)
  ) {
    throw new RazorpayError(
      "invalid_input",
      "Razorpay API and webhook secrets are required.",
    );
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  if (typeof fetchImpl !== "function") {
    throw new RazorpayError(
      "invalid_input",
      "A fetch implementation is required.",
    );
  }

  const authorization = `Basic ${btoa(`${config.keyId}:${config.keySecret}`)}`;

  async function requestJson(
    url: string,
    init: RequestInit,
    reconcileOnFailure = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status >= 500) {
          throw new RazorpayError(
            "provider_unavailable",
            reconcileOnFailure
              ? "Razorpay is temporarily unavailable; reconcile before retrying order creation."
              : "Razorpay is temporarily unavailable.",
          );
        }
        throw providerError("Razorpay rejected the request.");
      }
      try {
        return await response.json();
      } catch {
        if (reconcileOnFailure) {
          throw new RazorpayError(
            "provider_unavailable",
            "Razorpay order creation returned an unexpected result; reconcile before retrying.",
          );
        }
        throw providerError("Razorpay returned an invalid response.");
      }
    } catch (error) {
      if (error instanceof RazorpayError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new RazorpayError(
          "provider_unavailable",
          reconcileOnFailure
            ? "Razorpay request timed out; reconcile before retrying order creation."
            : "Razorpay request timed out.",
        );
      }
      throw new RazorpayError(
        "provider_unavailable",
        reconcileOnFailure
          ? "Razorpay could not be reached; reconcile before retrying order creation."
          : "Razorpay could not be reached.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async createOrder(input): Promise<CheckoutOrder> {
      if (!input || typeof input !== "object") {
        throw new RazorpayError(
          "invalid_input",
          "Order creation input is required.",
        );
      }
      const { checkoutRef, amountPaise } = input;
      if (
        typeof checkoutRef !== "string" ||
        checkoutRef.length < 1 || checkoutRef.length > 40 ||
        !/^[\x20-\x7e]+$/.test(checkoutRef) ||
        !Number.isSafeInteger(amountPaise) || amountPaise <= 0
      ) {
        throw new RazorpayError(
          "invalid_input",
          "A positive safe-integer paise amount and an ASCII receipt of at most 40 characters are required.",
        );
      }

      const body = await requestJson(`${API_BASE}/orders`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: checkoutRef,
        }),
      }, true);
      if (
        !isRecord(body) ||
        typeof body.id !== "string" || !ORDER_ID.test(body.id) ||
        body.amount !== amountPaise || body.currency !== "INR"
      ) {
        throw new RazorpayError(
          "provider_unavailable",
          "Razorpay order creation returned an unexpected result; reconcile before retrying.",
        );
      }

      return {
        keyId: config.keyId,
        orderId: body.id,
        amountPaise,
        currency: "INR",
      };
    },

    async verifyCheckout(input): Promise<boolean> {
      if (!input || typeof input !== "object") return false;
      const { storedOrderId, paymentId, signature } = input;
      if (
        !requiredString(storedOrderId) || !ORDER_ID.test(storedOrderId) ||
        !requiredString(paymentId) || !PAYMENT_ID.test(paymentId) ||
        typeof signature !== "string"
      ) return false;
      const message = new TextEncoder().encode(`${storedOrderId}|${paymentId}`);
      return await verifyHmac(config.keySecret, signature, message);
    },

    async verifyWebhook(input): Promise<VerifiedEvent> {
      if (!input || typeof input !== "object") {
        throw new RazorpayError(
          "invalid_input",
          "Razorpay webhook input is required.",
        );
      }
      const { rawBody, signature, eventId } = input;
      if (!requiredString(eventId) || eventId.trim().length === 0) {
        throw new RazorpayError(
          "invalid_input",
          "A Razorpay webhook event ID is required.",
        );
      }
      if (!(rawBody instanceof Uint8Array)) {
        throw new RazorpayError(
          "invalid_input",
          "The original webhook request bytes are required.",
        );
      }
      if (!await verifyHmac(config.webhookSecret, signature, rawBody)) {
        throw new RazorpayError(
          "invalid_signature",
          "Razorpay webhook signature is invalid.",
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(rawBody),
        );
      } catch {
        throw new RazorpayError(
          "invalid_payload",
          "Razorpay webhook payload is invalid.",
        );
      }
      if (!isRecord(payload) || !requiredString(payload.event)) {
        throw new RazorpayError(
          "invalid_payload",
          "Razorpay webhook event is missing or invalid.",
        );
      }

      const eventType = payload.event;
      if (
        !new Set(["payment.authorized", "payment.captured", "payment.failed"])
          .has(eventType)
      ) {
        return { kind: "ignored", eventId, eventType };
      }
      const eventPayload = isRecord(payload.payload) ? payload.payload : null;
      const paymentContainer = eventPayload && isRecord(eventPayload.payment)
        ? eventPayload.payment
        : null;
      const normalizedPayment = paymentContainer &&
        validatePaymentSnapshot(paymentContainer.entity);
      if (!normalizedPayment) {
        throw new RazorpayError(
          "invalid_payload",
          "Razorpay payment event details are invalid.",
        );
      }
      return {
        kind: "payment",
        eventId,
        eventType,
        payment: normalizedPayment,
      };
    },

    async fetchPayment(paymentId): Promise<PaymentSnapshot> {
      if (!requiredString(paymentId) || !PAYMENT_ID.test(paymentId)) {
        throw new RazorpayError(
          "invalid_input",
          "A valid Razorpay payment ID is required.",
        );
      }
      const response = await requestJson(
        `${API_BASE}/payments/${encodeURIComponent(paymentId)}`,
        {
          method: "GET",
          headers: { authorization, accept: "application/json" },
        },
      );
      const normalized = validatePaymentSnapshot(response);
      if (!normalized || normalized.paymentId !== paymentId) {
        throw providerError("Razorpay returned invalid payment details.");
      }
      return normalized;
    },
  };
}
