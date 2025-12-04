import { log } from "./cli.ts";

export class Timer {
  private initialTimestamp: number;
  private lastCheckpointTimestamp: number | null = null;

  constructor() {
    this.initialTimestamp = Date.now();
  }

  checkpoint(name: string): void {
    const now = Date.now();
    const duration = this.lastCheckpointTimestamp
      ? now - this.lastCheckpointTimestamp
      : now - this.initialTimestamp;

    log.info(`${name}: ${duration}ms`);
    this.lastCheckpointTimestamp = now;
  }
}
