type MetricBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
};

const requestMetrics = new Map<string, MetricBucket>();

export function recordRequestMetric(key: string, durationMs: number) {
  const existing = requestMetrics.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
  existing.count += 1;
  existing.totalMs += durationMs;
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  requestMetrics.set(key, existing);
}

export function renderMetricsPrometheus(): string {
  const lines: string[] = [];
  lines.push("# HELP sams_http_requests_total Total HTTP requests by route");
  lines.push("# TYPE sams_http_requests_total counter");
  lines.push("# HELP sams_http_request_duration_avg_ms Average request duration in ms by route");
  lines.push("# TYPE sams_http_request_duration_avg_ms gauge");
  lines.push("# HELP sams_http_request_duration_max_ms Max request duration in ms by route");
  lines.push("# TYPE sams_http_request_duration_max_ms gauge");

  for (const [key, bucket] of requestMetrics.entries()) {
    const avg = bucket.count === 0 ? 0 : bucket.totalMs / bucket.count;
    const label = key.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
    lines.push(`sams_http_requests_total{route="${label}"} ${bucket.count}`);
    lines.push(`sams_http_request_duration_avg_ms{route="${label}"} ${avg.toFixed(2)}`);
    lines.push(`sams_http_request_duration_max_ms{route="${label}"} ${bucket.maxMs.toFixed(2)}`);
  }

  return `${lines.join("\n")}\n`;
}

export function getMetricsSnapshot() {
  return [...requestMetrics.entries()].map(([route, item]) => ({
    route,
    count: item.count,
    avgMs: item.count === 0 ? 0 : Number((item.totalMs / item.count).toFixed(2)),
    maxMs: Number(item.maxMs.toFixed(2))
  }));
}
