import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, createMockLogger } from './helpers.js';

interface FakeEntry {
    getPassword: ReturnType<typeof vi.fn>;
    setPassword: ReturnType<typeof vi.fn>;
    deletePassword: ReturnType<typeof vi.fn>;
}

const entryHistory: Array<{ service: string; account: string; instance: FakeEntry }> = [];
let nextEntryFactory: ((service: string, account: string) => FakeEntry) | undefined;

vi.mock('@napi-rs/keyring', () => {
    class Entry {
        getPassword: FakeEntry['getPassword'];
        setPassword: FakeEntry['setPassword'];
        deletePassword: FakeEntry['deletePassword'];
        constructor(service: string, account: string) {
            const instance: FakeEntry = nextEntryFactory
                ? nextEntryFactory(service, account)
                : {
                      getPassword: vi.fn(() => null),
                      setPassword: vi.fn(() => undefined),
                      deletePassword: vi.fn(() => false),
                  };
            this.getPassword = instance.getPassword;
            this.setPassword = instance.setPassword;
            this.deletePassword = instance.deletePassword;
            entryHistory.push({ service, account, instance });
        }
    }
    return { Entry };
});

const { keyringEntry, __resetKeyringCache } = await import('../src/integrations/keyring/entry.js');

describe('keyringEntry', () => {
    beforeEach(() => {
        entryHistory.length = 0;
        nextEntryFactory = undefined;
        __resetKeyringCache();
    });

    it('reads a stored password through @napi-rs/keyring', async () => {
        nextEntryFactory = () => ({
            getPassword: vi.fn(() => 'sekrit'),
            setPassword: vi.fn(),
            deletePassword: vi.fn(() => false),
        });
        const entry = keyringEntry(createMockContext(), { service: 'svc', account: 'acct' });
        expect(await entry.read()).toBe('sekrit');
        expect(entryHistory[0]).toMatchObject({ service: 'svc', account: 'acct' });
    });

    it('returns null and warns when the underlying read throws', async () => {
        nextEntryFactory = () => ({
            getPassword: vi.fn(() => {
                throw new Error('keychain locked');
            }),
            setPassword: vi.fn(),
            deletePassword: vi.fn(() => false),
        });
        const logger = createMockLogger();
        const entry = keyringEntry(createMockContext({ logger }), { service: 's', account: 'a' });
        expect(await entry.read()).toBeNull();
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toContain('keychain locked');
    });

    it('writes successfully and returns true', async () => {
        const setPassword = vi.fn();
        nextEntryFactory = () => ({
            getPassword: vi.fn(() => null),
            setPassword,
            deletePassword: vi.fn(() => false),
        });
        const entry = keyringEntry(createMockContext(), { service: 's', account: 'a' });
        expect(await entry.write('value')).toBe(true);
        expect(setPassword).toHaveBeenCalledWith('value');
    });

    it('returns false and warns when write throws', async () => {
        nextEntryFactory = () => ({
            getPassword: vi.fn(() => null),
            setPassword: vi.fn(() => {
                throw new Error('denied');
            }),
            deletePassword: vi.fn(() => false),
        });
        const logger = createMockLogger();
        const entry = keyringEntry(createMockContext({ logger }), { service: 's', account: 'a' });
        expect(await entry.write('v')).toBe(false);
        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('delete returns the underlying boolean and swallows errors', async () => {
        nextEntryFactory = () => ({
            getPassword: vi.fn(() => null),
            setPassword: vi.fn(),
            deletePassword: vi.fn(() => true),
        });
        let entry = keyringEntry(createMockContext(), { service: 's', account: 'a' });
        expect(await entry.delete()).toBe(true);

        nextEntryFactory = () => ({
            getPassword: vi.fn(() => null),
            setPassword: vi.fn(),
            deletePassword: vi.fn(() => {
                throw new Error('nope');
            }),
        });
        __resetKeyringCache();
        entry = keyringEntry(createMockContext(), { service: 's', account: 'a' });
        expect(await entry.delete()).toBe(false);
    });
});

describe('keyringEntry with missing @napi-rs/keyring', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('degrades gracefully and warns once when the module cannot be loaded', async () => {
        vi.doMock('@napi-rs/keyring', () => {
            throw new Error('not installed');
        });
        const { keyringEntry: ke, __resetKeyringCache: reset } = await import('../src/integrations/keyring/entry.js');
        reset();

        const logger = createMockLogger();
        const entry = ke(createMockContext({ logger }), { service: 's', account: 'a' });

        expect(await entry.read()).toBeNull();
        expect(await entry.write('v')).toBe(false);
        expect(await entry.delete()).toBe(false);
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toContain('@napi-rs/keyring');

        vi.doUnmock('@napi-rs/keyring');
    });
});
