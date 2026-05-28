import { describe, it, expect } from 'vitest';
import { BusEvent } from '../src/bus.event.js';
import { EventSubscriber } from '../src/event.subscriber.js';

type TestEvent = BusEvent<'test.event'> & { value: string };

class TestSubscriber extends EventSubscriber<TestEvent> {
  received: TestEvent | null = null;
  async handle(event: TestEvent): Promise<void> {
    this.received = event;
  }
}

class FailingSubscriber extends EventSubscriber<TestEvent> {
  async handle(_event: TestEvent): Promise<void> {
    throw new Error('subscriber failed');
  }
}

describe('EventSubscriber', () => {
  it('is extendable', () => {
    const subscriber = new TestSubscriber();
    expect(subscriber).toBeInstanceOf(EventSubscriber);
  });

  it('exposes an abstract handle implemented by the subclass', () => {
    const subscriber = new TestSubscriber();
    expect(typeof subscriber.handle).toBe('function');
  });

  it('handle() receives the event and returns a Promise', async () => {
    const subscriber = new TestSubscriber();
    const event: TestEvent = { type: 'test.event', value: 'hello' };
    const result = subscriber.handle(event);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(subscriber.received).toEqual(event);
  });

  it('propagates errors thrown from handle()', async () => {
    const subscriber = new FailingSubscriber();
    await expect(subscriber.handle({ type: 'test.event', value: 'x' })).rejects.toThrow('subscriber failed');
  });
});
