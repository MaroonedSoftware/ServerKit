import { describe, it, expect } from 'vitest';
import { EventSubscriber } from '../src/event.subscriber.js';
import { EventSubscriberRegistryMap } from '../src/event.subscriber.registration.js';

class FirstSubscriber extends EventSubscriber {
  async handle(): Promise<void> {}
}

class SecondSubscriber extends EventSubscriber {
  async handle(): Promise<void> {}
}

describe('EventSubscriberRegistryMap', () => {
  it('is a Map', () => {
    const registry = new EventSubscriberRegistryMap();
    expect(registry).toBeInstanceOf(Map);
    expect(registry).toBeInstanceOf(EventSubscriberRegistryMap);
  });

  it('stores a single subscriber identifier per event type', () => {
    const registry = new EventSubscriberRegistryMap();
    registry.set('user.signed.up', [FirstSubscriber]);

    expect(registry.has('user.signed.up')).toBe(true);
    expect(registry.get('user.signed.up')).toEqual([FirstSubscriber]);
  });

  it('stores multiple subscribers for the same event type in order', () => {
    const registry = new EventSubscriberRegistryMap();
    registry.set('user.signed.up', [FirstSubscriber, SecondSubscriber]);

    const stored = registry.get('user.signed.up');
    expect(stored).toEqual([FirstSubscriber, SecondSubscriber]);
    expect(stored?.[0]).toBe(FirstSubscriber);
    expect(stored?.[1]).toBe(SecondSubscriber);
  });

  it('returns undefined for unknown event types', () => {
    const registry = new EventSubscriberRegistryMap();
    expect(registry.get('nothing.here')).toBeUndefined();
    expect(registry.has('nothing.here')).toBe(false);
  });

  it('supports delete and clear', () => {
    const registry = new EventSubscriberRegistryMap();
    registry.set('a.event', [FirstSubscriber]);
    registry.set('b.event', [SecondSubscriber]);

    registry.delete('a.event');
    expect(registry.has('a.event')).toBe(false);
    expect(registry.has('b.event')).toBe(true);

    registry.clear();
    expect(registry.size).toBe(0);
  });
});
