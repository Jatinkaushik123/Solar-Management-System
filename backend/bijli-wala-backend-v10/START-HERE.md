# Bijli Wala backend source

The deployed Supabase API v10 source is from Git commit ce1fb091e0294486bba6dee9f8e977c81b3730d0. Three API guides include the subsequent Razorpay Test Mode and quotation workflow verification.

- Start with the [release and environment setup guide](examples/backend-release.md).
- The Edge Function entry point is [supabase/functions/api/index.ts](supabase/functions/api/index.ts). Database migrations are under supabase/migrations, the server tests are under tests, and frontend contracts and examples are under examples.
- For frontend work, use the existing hosted API with the browser publishable key and synthetic role logins from the project owner. The [identity guide](examples/README.md) has the URL and client example.
- For a separate backend deployment, use a dedicated Supabase project and configure that project's Auth, Edge Function secrets, webhook and worker settings. The release describes owner setup for the integrations. This source export does not carry hosted data or credentials.
