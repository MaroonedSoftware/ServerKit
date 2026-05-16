import { describe, expect, it } from 'vitest';
import { createCliApp, defineCommand, isInteractive, type CommandModule } from '../src/index.js';

describe('johnny5 smoke', () => {
    it('exports core primitives', () => {
        expect(typeof createCliApp).toBe('function');
        expect(typeof defineCommand).toBe('function');
        expect(typeof isInteractive).toBe('function');
    });

    it('defineCommand returns the module unchanged', () => {
        const mod: CommandModule = { description: 'noop', run: async () => 0 };
        expect(defineCommand(mod)).toBe(mod);
    });

    it('createCliApp builds without registering checks or modules', async () => {
        const app = await createCliApp({
            name: 'test-cli',
            description: 'smoke',
            version: '0.0.0',
            commands: [
                {
                    path: ['noop'],
                    module: defineCommand({ description: 'noop', run: async () => 0 }),
                },
            ],
        });
        expect(typeof app.run).toBe('function');
    });
});
