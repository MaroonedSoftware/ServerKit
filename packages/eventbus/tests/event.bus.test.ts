import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from 'injectkit';
import { BusEvent } from '../src/bus.event.js';
import { EventBus } from '../src/event.bus.js';
import { EventSubscriber } from '../src/event.subscriber.js';
import { EventSubscriberRegistryMap } from '../src/event.subscriber.registration.js';

type TestEvent = BusEvent<'test.event'> & { value: string };

class FirstSubscriber extends EventSubscriber<TestEvent> {
  async handle(_event: TestEvent): Promise<void> {}
}

class SecondSubscriber extends EventSubscriber<TestEvent> {
  async handle(_event: TestEvent): Promise<void> {}
}

describe('EventBus', () => {
  let registry: EventSubscriberRegistryMap;
  let container: Container;

  beforeEach(() => {
    registry = new EventSubscriberRegistryMap();
    container = {
      get: vi.fn(),
    } as unknown as Container;
  });

  describe('publish', () => {
    it('throws when no subscribers are registered for the event type', async () => {
      const bus = new EventBus(registry, container);

      await expect(bus.publish({ type: 'test.event', value: 'x' })).rejects.toThrow(
        'No subscribers registered for event type test.event',
      );
      expect(container.get).not.toHaveBeenCalled();
    });

    it('resolves the subscriber from the container and awaits handle()', async () => {
      const subscriber = new FirstSubscriber();
      const handleSpy = vi.spyOn(subscriber, 'handle').mockResolvedValue(undefined);
      vi.mocked(container.get).mockReturnValue(subscriber);

      registry.set('test.event', [FirstSubscriber]);
      const bus = new EventBus(registry, container);

      const event: TestEvent = { type: 'test.event', value: 'hello' };
      await bus.publish(event);

      expect(container.get).toHaveBeenCalledWith(FirstSubscriber);
      expect(handleSpy).toHaveBeenCalledWith(event);
    });

    it('fans out to every registered subscriber in registration order', async () => {
      const first = new FirstSubscriber();
      const second = new SecondSubscriber();
      const order: string[] = [];

      vi.spyOn(first, 'handle').mockImplementation(async () => {
        await new Promise(resolve => setImmediate(resolve));
        order.push('first');
      });
      vi.spyOn(second, 'handle').mockImplementation(async () => {
        order.push('second');
      });

      vi.mocked(container.get).mockImplementation(identifier => {
        if (identifier === FirstSubscriber) return first;
        if (identifier === SecondSubscriber) return second;
        throw new Error('unexpected identifier');
      });

      registry.set('test.event', [FirstSubscriber, SecondSubscriber]);
      const bus = new EventBus(registry, container);

      await bus.publish({ type: 'test.event', value: 'x' });

      expect(order).toEqual(['first', 'second']);
    });

    it('aborts remaining subscribers when one throws (fail-fast)', async () => {
      const first = new FirstSubscriber();
      const second = new SecondSubscriber();
      const firstHandle = vi.spyOn(first, 'handle').mockRejectedValue(new Error('boom'));
      const secondHandle = vi.spyOn(second, 'handle').mockResolvedValue(undefined);

      vi.mocked(container.get).mockImplementation(identifier => {
        if (identifier === FirstSubscriber) return first;
        if (identifier === SecondSubscriber) return second;
        throw new Error('unexpected identifier');
      });

      registry.set('test.event', [FirstSubscriber, SecondSubscriber]);
      const bus = new EventBus(registry, container);

      await expect(bus.publish({ type: 'test.event', value: 'x' })).rejects.toThrow('boom');
      expect(firstHandle).toHaveBeenCalledOnce();
      expect(secondHandle).not.toHaveBeenCalled();
    });

    it('resolves a fresh instance from the container on every publish', async () => {
      const subscriber = new FirstSubscriber();
      vi.spyOn(subscriber, 'handle').mockResolvedValue(undefined);
      vi.mocked(container.get).mockReturnValue(subscriber);

      registry.set('test.event', [FirstSubscriber]);
      const bus = new EventBus(registry, container);

      await bus.publish({ type: 'test.event', value: 'a' });
      await bus.publish({ type: 'test.event', value: 'b' });
      await bus.publish({ type: 'test.event', value: 'c' });

      expect(container.get).toHaveBeenCalledTimes(3);
    });

    it('does not dispatch subscribers registered for other event types', async () => {
      const first = new FirstSubscriber();
      const second = new SecondSubscriber();
      const firstHandle = vi.spyOn(first, 'handle').mockResolvedValue(undefined);
      const secondHandle = vi.spyOn(second, 'handle').mockResolvedValue(undefined);

      vi.mocked(container.get).mockImplementation(identifier => {
        if (identifier === FirstSubscriber) return first;
        if (identifier === SecondSubscriber) return second;
        throw new Error('unexpected identifier');
      });

      registry.set('a.event', [FirstSubscriber]);
      registry.set('b.event', [SecondSubscriber]);
      const bus = new EventBus(registry, container);

      await bus.publish({ type: 'a.event' });

      expect(firstHandle).toHaveBeenCalledOnce();
      expect(secondHandle).not.toHaveBeenCalled();
    });
  });
});
