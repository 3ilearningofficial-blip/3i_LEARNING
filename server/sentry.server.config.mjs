import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    "https://c0fc55467835c0568a9731fc197c9b36@o4511353056264192.ingest.us.sentry.io/4511353879134208",
  integrations: [Sentry.expressIntegration(), nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
  debug: true,
});
