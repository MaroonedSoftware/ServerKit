import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTypescriptLoader, runTypescriptBin } from '../src/bin.shim.js';

const { registerMock } = vi.hoisted(() => ({ registerMock: vi.fn() }));

vi.mock('node:module', async importOriginal => {
    const actual = await importOriginal<typeof import('node:module')>();
    return { ...actual, register: registerMock };
});

describe('bin shim', () => {
    const binUrl = 'file:///workspace/pkg/bin/cli.js';
    const originalSwcProject = process.env['SWC_NODE_PROJECT'];
    const originalNoDeprecation = process.noDeprecation;

    beforeEach(() => {
        registerMock.mockReset();
        delete process.env['SWC_NODE_PROJECT'];
    });

    afterEach(() => {
        if (originalSwcProject === undefined) delete process.env['SWC_NODE_PROJECT'];
        else process.env['SWC_NODE_PROJECT'] = originalSwcProject;
        process.noDeprecation = originalNoDeprecation;
    });

    it('anchors the loader hook to the bin file URL, not process.cwd()', () => {
        registerTypescriptLoader(binUrl);
        expect(registerMock).toHaveBeenCalledTimes(1);
        expect(registerMock).toHaveBeenCalledWith('@swc-node/register/esm', binUrl);
    });

    it('points SWC_NODE_PROJECT at the package tsconfig derived from the bin URL', () => {
        registerTypescriptLoader(binUrl);
        expect(process.env['SWC_NODE_PROJECT']).toBe(fileURLToPath(new URL('../tsconfig.json', binUrl)));
    });

    it('respects an SWC_NODE_PROJECT already present in the environment', () => {
        process.env['SWC_NODE_PROJECT'] = '/elsewhere/tsconfig.json';
        registerTypescriptLoader(binUrl);
        expect(process.env['SWC_NODE_PROJECT']).toBe('/elsewhere/tsconfig.json');
    });

    it('honours a custom tsconfig path relative to the bin URL', () => {
        registerTypescriptLoader(binUrl, { tsconfig: '../tsconfig.cli.json' });
        expect(process.env['SWC_NODE_PROJECT']).toBe(fileURLToPath(new URL('../tsconfig.cli.json', binUrl)));
    });

    it('suppresses deprecation warnings only for the duration of the register call', () => {
        process.noDeprecation = false;
        let duringCall: boolean | undefined;
        registerMock.mockImplementationOnce(() => {
            duringCall = process.noDeprecation;
        });
        registerTypescriptLoader(binUrl);
        expect(duringCall).toBe(true);
        expect(process.noDeprecation).toBe(false);
    });

    it('restores noDeprecation and rethrows with an install hint when register fails', () => {
        process.noDeprecation = false;
        registerMock.mockImplementationOnce(() => {
            throw new Error('Cannot find module');
        });
        expect(() => registerTypescriptLoader(binUrl)).toThrowError(/@swc-node\/register/);
        expect(process.noDeprecation).toBe(false);
    });

    it('runTypescriptBin registers and imports the default ../src/index.ts entry', async () => {
        const fixtureBinUrl = new URL('./fixtures/binshim/bin/cli.js', import.meta.url).href;
        const mod = (await runTypescriptBin(fixtureBinUrl)) as { binShimFixtureEntry: string };
        expect(registerMock).toHaveBeenCalledWith('@swc-node/register/esm', fixtureBinUrl);
        expect(mod.binShimFixtureEntry).toBe('default');
        expect(process.env['SWC_NODE_PROJECT']).toBe(fileURLToPath(new URL('./fixtures/binshim/tsconfig.json', import.meta.url)));
    });

    it('runTypescriptBin honours a custom entry path', async () => {
        const entry = new URL('./fixtures/bin.entry.ts', import.meta.url).href;
        const mod = (await runTypescriptBin(binUrl, { entry })) as { binShimFixtureEntry: string };
        expect(mod.binShimFixtureEntry).toBe('custom');
    });
});
