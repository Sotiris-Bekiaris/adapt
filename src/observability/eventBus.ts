export interface EventBusOptions {
  bufferSize?: number;
}

/** Minimal synchronous pub/sub with a bounded replay buffer. */
export class EventBus<T> {
  private subscribers = new Set<(e: T) => void>();
  private buffer: T[] = [];
  private bufferSize: number;

  constructor(opts: EventBusOptions = {}) {
    this.bufferSize = opts.bufferSize ?? 500;
  }

  subscribe(fn: (e: T) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(event: T): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    for (const fn of this.subscribers) fn(event);
  }

  recent(): T[] {
    return [...this.buffer];
  }
}
