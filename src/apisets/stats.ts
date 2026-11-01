const WINDOW = 50;

const keepLast = <T>(values: T[], value: T) => [...values, value].slice(-WINDOW);

const percentile = (values: number[], p: number): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

/** Rolling latency and outcome samples of one node for one API set. */
export class NodeStats {
  private latencies: number[] = [];
  private checkLatencies: number[] = [];
  private outcomes: boolean[] = [];
  consecutiveTransportFailures = 0;

  addLatency(latencyMs: number) {
    this.latencies = keepLast(this.latencies, latencyMs);
  }

  /** wax's HealthChecker reports its whole latency history each round; it replaces the previous one. */
  setCheckLatencies(latencies: number[]) {
    this.checkLatencies = latencies.slice(-WINDOW);
  }

  addOutcome(ok: boolean) {
    this.outcomes = keepLast(this.outcomes, ok);
  }

  get sampleCount() {
    return this.outcomes.length;
  }

  median() {
    return percentile([...this.latencies, ...this.checkLatencies], 50);
  }

  p95() {
    return percentile([...this.latencies, ...this.checkLatencies], 95);
  }

  errorRate() {
    return this.outcomes.length ? this.outcomes.filter((ok) => !ok).length / this.outcomes.length : undefined;
  }
}
