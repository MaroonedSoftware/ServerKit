import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PermissionsConfig } from './config.js';

const MANIFEST_VERSION = 1 as const;

/** Per-namespace output bookkeeping recorded in the manifest. */
export interface CachedNamespaceOutput {
    path: string;
    contentHash: string;
}

/** Per-input-file entry in the manifest. */
export interface CachedFileEntry {
    sourceHash: string;
    /** Namespace names declared in the file, in encounter order. */
    namespaceNames: string[];
    /** Names of *all* namespaces visible during the last successful compile (own + siblings). Used to decide whether sibling drift forces a re-lower. */
    visibleNames: string[];
    outputs: Record<string, CachedNamespaceOutput>;
}

/** On-disk manifest. Stored as JSON; `version` lets us bump shape later. */
export interface CacheManifest {
    version: typeof MANIFEST_VERSION;
    configHash: string;
    files: Record<string, CachedFileEntry>;
    index: { path: string; contentHash: string } | null;
}

const empty = (configHash: string): CacheManifest => ({ version: MANIFEST_VERSION, configHash, files: {}, index: null });

/** sha256 hex of a string. */
export const hashString = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Compose the configHash from every field that, if changed, must invalidate the entire cache. */
export const computeConfigHash = (config: PermissionsConfig, compilerVersion: string): string =>
    hashString(
        JSON.stringify({
            compilerVersion,
            permissionsImport: config.permissionsImport ?? null,
            prettier: config.prettier,
            namespaceTemplate: config.output.namespace,
            modelOutput: config.output.model,
            baseDir: config.output.baseDir,
        }),
    );

/**
 * Load the manifest at `path`. Returns a fresh empty manifest when the file is
 * missing, unreadable, malformed, version-mismatched, or has a different
 * `configHash`. A broken cache must never fail the build.
 */
export const loadManifest = async (path: string, configHash: string): Promise<CacheManifest> => {
    try {
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as CacheManifest;
        if (parsed.version !== MANIFEST_VERSION || parsed.configHash !== configHash) return empty(configHash);
        return parsed;
    } catch {
        return empty(configHash);
    }
};

/** Persist the manifest. Best-effort: write failures are swallowed so a broken cache dir never fails a successful compile. */
export const saveManifest = async (path: string, manifest: CacheManifest): Promise<void> => {
    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(manifest, null, 2), 'utf8');
    } catch {
        // best-effort
    }
};
