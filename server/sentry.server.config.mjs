import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    "https://d7c714bdd1391597e651669e7a87ba26@o4511353056264192.ingest.us.sentry.io/4511353198346240",
  integrations: [Sentry.expressIntegration(), nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
