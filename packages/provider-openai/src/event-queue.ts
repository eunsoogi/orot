export class EventQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: ((value: T | undefined) => void)[] = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  close(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter(undefined);
  }

  next(): Promise<T | undefined> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    if (this.ended) return Promise.resolve(undefined);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
