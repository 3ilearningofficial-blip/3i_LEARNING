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
  const key = `${req.method} ${req.path}`;
  const start = Date.now();
  res.on("finish", () => {
    const b = getBucket(key);
    b.count += 1;
    b.totalLatencyMs += Date.now() - start;
    if (res.statusCode >= 500) b.errorCount += 1;
  });
  next();
}

export function getMetricsSnapshot() {
  const routes: Array<{ key: string; count: number; errorRate: number; avgLatencyMs: number }> = [];
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
