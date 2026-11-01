const WINDOW = 50;

const keepLast = <T>(values: T[], value: T) => [...values, value].slice(-WINDOW);

const percentile = (values: number[], p: number): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

/** {@link NodeStats}' samples, as JSON. */
export interface StatsSnapshot {
  latencies: number[];
  checkLatencies: number[];
  successes: number;
  failures: number;
}

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

  snapshot(): StatsSnapshot {
    const failures = this.outcomes.filter((ok) => !ok).length;
    return { latencies: [...this.latencies], checkLatencies: [...this.checkLatencies], successes: this.outcomes.length - failures, failures };
  }

  /** Replaces the samples with a {@link snapshot}'s; the order of the outcomes is not kept. */
  restore({ latencies, checkLatencies, successes, failures }: StatsSnapshot) {
    this.latencies = latencies.slice(-WINDOW);
    this.checkLatencies = checkLatencies.slice(-WINDOW);
    const failed = Math.min(failures, WINDOW);
    this.outcomes = [...Array<boolean>(failed).fill(false), ...Array<boolean>(Math.min(successes, WINDOW - failed)).fill(true)];
  }

  errorRate() {
    return this.outcomes.length ? this.outcomes.filter((ok) => !ok).length / this.outcomes.length : undefined;
  }
}
