import type { ChannelId } from './comms.event.js';
import type { OutgoingMessage } from './comms.message.js';

/** Renders template data into a channel-native payload (rich, channel-specific). */
export type NativeRenderer<D = unknown> = (data: D) => unknown;
/** Renders template data into a portable {@link OutgoingMessage} (cross-channel fallback). */
export type PortableRenderer<D = unknown> = (data: D) => OutgoingMessage;

/**
 * Result of {@link TemplateRegistry.render}: either a channel-native payload (a
 * per-channel renderer matched) or a portable message (the default fallback),
 * or `undefined` when no template is registered under the name.
 */
export type TemplateRenderResult = { kind: 'native'; payload: unknown } | { kind: 'portable'; message: OutgoingMessage } | undefined;

/**
 * A registry of named outbound templates. Register a **rich, per-channel**
 * renderer with {@link register} and/or a **portable default** with
 * {@link registerDefault}; adapters resolve a template for the current channel
 * via {@link render}, with channel-native taking precedence over the default.
 *
 * The registry stores plain functions — a consumer is free to back a renderer
 * with Handlebars or any engine. No template engine is bundled.
 *
 * @example
 * ```ts
 * registry.register('order.card', 'slack', d => ({ blocks: [...] }));
 * registry.registerDefault('order.card', d => ({ text: `Order ${d.id} ✅` }));
 * ```
 */
export class TemplateRegistry {
  private readonly native = new Map<string, Map<ChannelId, NativeRenderer>>();
  private readonly defaults = new Map<string, PortableRenderer>();

  /** Register a channel-native renderer for `name` on `channel`. */
  register<D>(name: string, channel: ChannelId, render: NativeRenderer<D>): this {
    let byChannel = this.native.get(name);
    if (!byChannel) {
      byChannel = new Map();
      this.native.set(name, byChannel);
    }
    byChannel.set(channel, render as NativeRenderer);
    return this;
  }

  /** Register the portable default renderer for `name`, used on channels without a native renderer. */
  registerDefault<D>(name: string, render: PortableRenderer<D>): this {
    this.defaults.set(name, render as PortableRenderer);
    return this;
  }

  /**
   * Resolve and run the best renderer for `name` on `channel`: a channel-native
   * renderer if registered, else the portable default, else `undefined`.
   */
  render(name: string, channel: ChannelId, data: unknown): TemplateRenderResult {
    const nativeRenderer = this.native.get(name)?.get(channel);
    if (nativeRenderer) return { kind: 'native', payload: nativeRenderer(data) };
    const portable = this.defaults.get(name);
    if (portable) return { kind: 'portable', message: portable(data) };
    return undefined;
  }
}
