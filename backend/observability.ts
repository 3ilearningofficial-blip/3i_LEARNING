import type { Request, Response, NextFunction } from "express";

type Bucket = {
  count: number;
  errorCount: number;
  totalLatencyMs: number;
};

const routeMetrics = new Map<string, Bucket>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function getBucket(key: string): Bucket {
  let b = routeMetrics.get(key);
  if (!b) {
    b = { count: 0, errorCount: 0, totalLatencyMs: 0 };
    routeMetrics.set(key, b);
  }
  return b;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use req.route.path (the Express route pattern, e.g. /api/courses/:id) rather than
  // req.path (the actual URL, e.g. /api/courses/123). Using req.path causes the Map to
  // grow one entry per unique URL — unbounded memory growth as content is added.
  // req.route is set by Express after the matching route handler runs, so we read it
  // inside the 'finish' event where it is guaranteed to be populated.
  const capturedPath = req.path;
  const start = Date.now();
  res.on("finish", () => {
    // Prefer the matched route pattern over the raw path to prevent unbounded Map growth.
    const routePattern = (req as any).route?.path;
    const key = `${req.method} ${routePattern || capturedPath}`;
    const b = getBucket(key);
    b.count += 1;
    b.totalLatencyMs += Date.now() - start;
    if (res.statusCode >= 500) b.errorCount += 1;
  });
  next();
}

export function getMetricsSnapshot() {
  const routes: { key: string; count: number; errorRate: number; avgLatencyMs: number }[] = [];
  for (const [key, b] of routeMetrics) {
    routes.push({
      key,
      count: b.count,
      errorRate: b.count > 0 ? b.errorCount / b.count : 0,
      avgLatencyMs: b.count > 0 ? Math.round(b.totalLatencyMs / b.count) : 0,
    });
  }
  return {
    collectedAt: Date.now(),
    routes: routes.sort((a, b) => b.count - a.count).slice(0, 300),
    counters: Object.fromEntries(counters.entries()),
    gauges: Object.fromEntries(gauges.entries()),
  };
}

export function incrementCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) || 0) + by);
}

export function setGauge(name: string, value: number): void {
  gauges.set(name, value);
}
