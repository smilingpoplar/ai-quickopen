import type { WarmProvider } from '../types';

class NoopWarmProvider implements WarmProvider {
  async ensureReady() {
    return;
  }

  async acquire() {
    return null;
  }

  async close() {
    return;
  }

  async dispose() {
    return;
  }
}

export { NoopWarmProvider };
