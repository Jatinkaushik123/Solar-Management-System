import { createRazorpayGateway, type RazorpayGateway } from "../_shared/razorpay/mod.ts";
export type { PaymentSnapshot, RazorpayGateway as Gateway } from "../_shared/razorpay/mod.ts";

export function configuredGateway(env: (key: string) => string | undefined): RazorpayGateway | null {
  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");
  const webhookSecret = env("RAZORPAY_WEBHOOK_SECRET");
  if (!keyId || !/^rzp_test_[A-Za-z0-9]+$/.test(keyId) || !keySecret || !webhookSecret) return null;
  return createRazorpayGateway({ keyId, keySecret, webhookSecret });
}
