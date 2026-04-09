/**
 * Ring Buffer — Fixed-capacity circular buffer for time-series data.
 *
 * Stores the most recent N items efficiently. When capacity is reached,
 * the oldest item is evicted. Used for candle and ticker storage.
 */

export class RingBuffer<T> {
  private items: T[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = new Array(capacity);
  }

  push(item: T): void {
    this.items[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** Returns items oldest-first */
  toArray(): T[] {
    const result: T[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.items[(this.head + i) % this.capacity];
    }
    return result;
  }

  /** Get the most recent item */
  latest(): T | undefined {
    if (this.count === 0) return undefined;
    return this.items[(this.head + this.count - 1) % this.capacity];
  }

  /** Get the N most recent items, newest-first */
  lastN(n: number): T[] {
    const take = Math.min(n, this.count);
    const result: T[] = new Array(take);
    for (let i = 0; i < take; i++) {
      result[i] = this.items[(this.head + this.count - 1 - i) % this.capacity];
    }
    return result.reverse();
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
