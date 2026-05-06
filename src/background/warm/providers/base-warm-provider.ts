import type { WarmItem, WarmProvider, WarmState } from '../types';

type QueueWaiter = { id: number; resolve: () => void };

abstract class BaseWarmProvider implements WarmProvider {
  private _warmItem: WarmItem | null;
  private _waiting: QueueWaiter[];
  private _waitingSeq: number;
  private _ensureReadyPromise: Promise<void> | null;
  private _state: WarmState;

  constructor() {
    this._warmItem = null;
    this._waiting = [];
    this._waitingSeq = 0;
    this._ensureReadyPromise = null;
    this._state = 'idle';
  }

  get state() {
    return this._state;
  }

  protected get warmItem() {
    return this._warmItem;
  }

  protected setWarmState(state: WarmState) {
    this._state = state;
  }

  protected clearInMemoryWarmItem() {
    this._warmItem = null;
  }

  protected async setWarmItem(item: WarmItem) {
    if (this._warmItem) {
      return;
    }

    this._warmItem = item;
    this._state = 'ready';
    await this.persistWarmItem(item);
    this.notifyWaiters();
  }

  async ensureReady() {
    if (!this._warmItem) {
      this._state = 'warming';
    }
    await this.requestEnsureReady();
  }

  async acquire(timeoutMs?: number) {
    const deadline = typeof timeoutMs === 'number' ? Date.now() + timeoutMs : null;

    while (true) {
      if (!this._warmItem) {
        this._state = 'warming';
        void this.requestEnsureReady();

        while (!this._warmItem) {
          let remaining: number | undefined;
          if (deadline !== null) {
            remaining = deadline - Date.now();
            if (remaining <= 0) {
              return null;
            }
          }

          const hasItem = await this.waitForItem(remaining);
          if (!hasItem) {
            return null;
          }
        }
      }

      const item = this._warmItem;
      this._warmItem = null;
      this._state = 'consuming';

      if (!item) {
        continue;
      }

      const consumed = await this.consumeWarmItem(item);
      if (consumed) {
        return consumed;
      }
    }
  }

  protected requestEnsureReady() {
    if (!this._ensureReadyPromise) {
      if (!this._warmItem) {
        this._state = 'warming';
      }
      this._ensureReadyPromise = this.ensureFilled()
        .catch(() => {
          // noop: acquire has timeout fallback.
        })
        .finally(() => {
          this._ensureReadyPromise = null;
          if (this._state !== 'consuming') {
            this._state = this._warmItem ? 'ready' : 'idle';
          }
          this.notifyWaiters();
        });
    }

    return this._ensureReadyPromise;
  }

  private removeWaiter(waiterId: number) {
    this._waiting = this._waiting.filter(waiter => waiter.id !== waiterId);
  }

  protected notifyWaiters() {
    while (this._waiting.length > 0) {
      const waiter = this._waiting.shift();
      waiter?.resolve();
    }
  }

  private waitForItem(timeoutMs?: number) {
    if (this._warmItem) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const waiterId = ++this._waitingSeq;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const waiter: QueueWaiter = {
        id: waiterId,
        resolve: () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve(true);
        },
      };
      this._waiting.push(waiter);

      if (typeof timeoutMs === 'number' && timeoutMs >= 0) {
        timeoutId = setTimeout(() => {
          this.removeWaiter(waiterId);
          resolve(false);
        }, timeoutMs);
      }
    });
  }

  protected abstract ensureFilled(): Promise<void>;
  protected abstract consumeWarmItem(item: WarmItem): Promise<WarmItem | null>;
  protected abstract persistWarmItem(item: WarmItem): Promise<void>;
  abstract close(): Promise<void>;
  abstract dispose(): Promise<void>;
}

export { BaseWarmProvider };
