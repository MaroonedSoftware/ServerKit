import { describe, it, expect } from 'vitest';
import { TemplateRegistry } from '../src/comms.template.js';

describe('TemplateRegistry', () => {
  it('renders a channel-native template when one is registered', () => {
    const registry = new TemplateRegistry();
    registry.register('order.card', 'slack', (d: { id: string }) => ({ blocks: [{ text: d.id }] }));

    const result = registry.render('order.card', 'slack', { id: 'O1' });
    expect(result).toEqual({ kind: 'native', payload: { blocks: [{ text: 'O1' }] } });
  });

  it('falls back to the portable default on channels without a native renderer', () => {
    const registry = new TemplateRegistry();
    registry.register('order.card', 'slack', () => ({ blocks: [] }));
    registry.registerDefault('order.card', (d: { id: string }) => ({ text: `Order ${d.id}` }));

    const result = registry.render('order.card', 'telegram', { id: 'O2' });
    expect(result).toEqual({ kind: 'portable', message: { text: 'Order O2' } });
  });

  it('prefers the channel-native renderer over the default', () => {
    const registry = new TemplateRegistry();
    registry.registerDefault('order.card', () => ({ text: 'default' }));
    registry.register('order.card', 'slack', () => ({ blocks: ['native'] }));

    expect(registry.render('order.card', 'slack', {})).toEqual({ kind: 'native', payload: { blocks: ['native'] } });
  });

  it('returns undefined for an unregistered template', () => {
    const registry = new TemplateRegistry();
    expect(registry.render('missing', 'slack', {})).toBeUndefined();
  });

  it('supports method chaining', () => {
    const registry = new TemplateRegistry();
    expect(registry.register('a', 'slack', () => ({})).registerDefault('a', () => ({ text: 'x' }))).toBe(registry);
  });
});
