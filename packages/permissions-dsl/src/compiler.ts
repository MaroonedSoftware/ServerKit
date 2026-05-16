import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { glob } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderIndex, renderNamespace } from './codegen.js';
import { parse } from './parser.js';
import { validateFile } from './validate.js';
import { AggregateCompileError, CompileError } from './diagnostics.js';
import { computeConfigHash, hashString, loadManifest, saveManifest, type CacheManifest, type CachedFileEntry } from './cache.js';
import type { PermissionsConfig } from './config.js';
import type { FileNode, NamespaceNode } from './ast.js';

const stripExt = (p: string): string => p.replace(/\.[a-z0-9]+$/i, '');

const resolveNamespaceOutput = (config: PermissionsConfig, namespace: string): string => {
    const tmpl = config.output.namespace.replace(/\{filename\}/g, namespace);
    return resolve(config.output.baseDir, tmpl);
};

const resolveModelOutput = (config: PermissionsConfig): string => resolve(config.output.baseDir, config.output.model);

const importSpecifierFor = (fromFile: string, toFile: string): string => {
    let rel = relative(dirname(fromFile), stripExt(toFile));
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `${rel}.js`;
};

const expandPatterns = async (config: PermissionsConfig): Promise<string[]> => {
    const out = new Set<string>();
    for (const pattern of config.patterns) {
        for await (const match of glob(pattern, { cwd: config.rootDir })) {
            out.add(resolve(config.rootDir, match));
        }
    }
    return [...out].sort();
};

const formatWithPrettier = async (source: string, filepath: string): Promise<string> => {
    const prettier = await import('prettier');
    const config = (await prettier.resolveConfig(filepath)) ?? {};
    return prettier.format(source, { ...config, filepath });
};

interface ParsedFile {
    filename: string;
    source: string;
    sourceHash: string;
    file: FileNode;
}

/** Result of a successful {@link compile} run — absolute paths and namespace names. */
export interface CompileResult {
    /** Absolute paths of every `.perm` file that was read. */
    inputs: string[];
    /** Absolute paths of every TypeScript file that was written this run. Excludes files served from cache (unchanged on disk). */
    outputs: string[];
    /** Names of the namespaces declared across all inputs, in encounter order. */
    namespaces: string[];
    /** Names of namespaces whose outputs were served from cache and not rewritten. */
    cached: string[];
    /** Absolute paths of generated files removed because their source namespace no longer exists. */
    orphaned: string[];
}

const readCompilerVersion = async (): Promise<string> => {
    try {
        const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
        const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version?: string };
        return pkg.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
};

/** Options that tweak how {@link compile} runs without affecting compilation semantics. */
export interface CompileOptions {
    /**
     * When `true`, run the full parse/validate/codegen pipeline but skip every
     * side effect: don't write outputs, don't delete orphans, don't update the
     * cache manifest. The returned `CompileResult` still lists what *would*
     * have been written (`outputs`) and removed (`orphaned`), so callers can
     * detect drift without touching disk. Useful for CI/doctor checks that ask
     * "is the generated TypeScript in sync with the .perm sources?".
     */
    dryRun?: boolean;
}

/**
 * Compile every `.perm` file matched by `config.patterns` into TypeScript.
 * Pipeline: discover → parse → cross-file duplicate-namespace check → per-file
 * semantic validation (with sibling namespaces visible) → codegen → optional
 * prettier pass → write.
 *
 * Reuses outputs from `<cacheDir>/manifest.json` when an input file's source
 * hash and visible-namespace name set are unchanged since the last run.
 * Diagnostics across files are aggregated and surfaced as an
 * {@link AggregateCompileError}.
 *
 * Output: one file per namespace at `output.namespace` (with `{filename}`
 * replaced by the namespace name) plus an aggregate `output.model` file that
 * re-exports the namespaces and constructs an `AuthorizationModel`. Generated
 * files whose source namespace no longer exists are deleted.
 *
 * Pass `{ dryRun: true }` to plan without writing — see {@link CompileOptions}.
 *
 * @throws {AggregateCompileError} when one or more files produce
 *   {@link CompileError}s (grammar errors, duplicate or unknown names,
 *   tupleToUserset references that don't resolve, or invalid models).
 * @throws {Error} if no files match `patterns`.
 */
export const compile = async (config: PermissionsConfig, options: CompileOptions = {}): Promise<CompileResult> => {
    const dryRun = options.dryRun === true;
    const inputs = await expandPatterns(config);
    if (inputs.length === 0) {
        throw new Error(`no files matched patterns: ${config.patterns.join(', ')}`);
    }

    const compilerVersion = await readCompilerVersion();
    const configHash = computeConfigHash(config, compilerVersion);
    const cacheDir = config.cacheDir ?? resolve(config.rootDir, 'node_modules', '.cache', 'pdsl');
    const manifestPath = resolve(cacheDir, 'manifest.json');
    const prevManifest = await loadManifest(manifestPath, configHash);

    // 1. Parse every file. (Parsing is cheap; we always re-parse so namespace
    //    names — which feed the cross-file dup check — are authoritative.)
    const parsed: ParsedFile[] = [];
    const errors: CompileError[] = [];
    for (const filename of inputs) {
        const source = await readFile(filename, 'utf8');
        const sourceHash = hashString(source);
        try {
            const file = parse({ source, filename });
            parsed.push({ filename, source, sourceHash, file });
        } catch (err) {
            if (err instanceof CompileError) errors.push(err);
            else throw err;
        }
    }

    // 2. Cross-file: detect every duplicate namespace (continue past the first).
    const firstSeen = new Map<string, ParsedFile>();
    for (const p of parsed) {
        for (const ns of p.file.namespaces) {
            const prior = firstSeen.get(ns.name);
            if (prior && prior.filename !== p.filename) {
                errors.push(
                    new CompileError({
                        source: p.source,
                        filename: p.filename,
                        span: ns.nameLoc,
                        message: `duplicate namespace '${ns.name}' (also declared in ${prior.filename})`,
                    }),
                );
                continue;
            }
            if (!prior) firstSeen.set(ns.name, p);
        }
    }

    // 3. Per-file validation — each file sees its own namespaces plus sibling
    //    namespaces from other files. Skip lower() for files whose source AND
    //    visible-name set match the previous run.
    const allNamespaces: NamespaceNode[] = parsed.flatMap(p => p.file.namespaces);
    const allNames = allNamespaces.map(n => n.name);

    interface FilePlan {
        parsed: ParsedFile;
        visibleNames: string[];
        cached: boolean;
    }

    const plans: FilePlan[] = parsed.map(p => {
        const ownNames = new Set(p.file.namespaces.map(n => n.name));
        const visibleNames = [...p.file.namespaces.map(n => n.name), ...allNames.filter(n => !ownNames.has(n))];
        const prev = prevManifest.files[p.filename];
        const cached =
            prev !== undefined &&
            prev.sourceHash === p.sourceHash &&
            arrayEquals(prev.visibleNames, visibleNames) &&
            prev.namespaceNames.every(n => prev.outputs[n] !== undefined);
        return { parsed: p, visibleNames, cached };
    });

    for (const plan of plans) {
        if (plan.cached) continue;
        const ownNames = new Set(plan.parsed.file.namespaces.map(n => n.name));
        const siblings = allNamespaces.filter(n => !ownNames.has(n.name));
        const result = validateFile({ source: plan.parsed.source, filename: plan.parsed.filename, siblings });
        if (result.error) errors.push(result.error);
    }

    if (errors.length > 0) {
        throw new AggregateCompileError(errors);
    }

    // 4. Codegen — one TS file per namespace + an aggregate index.
    const writtenOutputs: string[] = [];
    const cachedNamespaces: string[] = [];
    const namespaceNames: string[] = [];
    const namespaceImports: { name: string; from: string }[] = [];
    const modelOut = resolveModelOutput(config);
    const newFiles: Record<string, CachedFileEntry> = {};

    for (const plan of plans) {
        const fileEntry: CachedFileEntry = {
            sourceHash: plan.parsed.sourceHash,
            namespaceNames: plan.parsed.file.namespaces.map(n => n.name),
            visibleNames: plan.visibleNames,
            outputs: {},
        };
        const prev = prevManifest.files[plan.parsed.filename];

        for (const ns of plan.parsed.file.namespaces) {
            const outPath = resolveNamespaceOutput(config, ns.name);
            namespaceImports.push({ name: ns.name, from: importSpecifierFor(modelOut, outPath) });
            namespaceNames.push(ns.name);

            if (plan.cached && prev) {
                const cached = prev.outputs[ns.name];
                if (cached && cached.path === outPath) {
                    fileEntry.outputs[ns.name] = cached;
                    cachedNamespaces.push(ns.name);
                    continue;
                }
            }

            const file = renderNamespace(ns, { permissionsImport: config.permissionsImport });
            const formatted = config.prettier ? await formatWithPrettier(file.source, outPath) : file.source;
            const written = dryRun ? await wouldWrite(outPath, formatted) : await writeIfChanged(outPath, formatted);
            if (written) writtenOutputs.push(outPath);
            fileEntry.outputs[ns.name] = { path: outPath, contentHash: hashString(formatted) };
        }

        newFiles[plan.parsed.filename] = fileEntry;
    }

    // 5. Aggregate index — rebuild whenever the namespace name set or order
    //    changes, or when the model output path moves.
    const indexSrc = renderIndex({ permissionsImport: config.permissionsImport, namespaceImports });
    const formattedIndex = config.prettier ? await formatWithPrettier(indexSrc, modelOut) : indexSrc;
    const indexContentHash = hashString(formattedIndex);
    const indexNeedsWrite = prevManifest.index === null || prevManifest.index.path !== modelOut || prevManifest.index.contentHash !== indexContentHash;
    if (indexNeedsWrite) {
        const written = dryRun ? await wouldWrite(modelOut, formattedIndex) : await writeIfChanged(modelOut, formattedIndex);
        if (written) writtenOutputs.push(modelOut);
    }

    // 6. Orphan cleanup — anything the previous run wrote that this run didn't.
    const currentOutputs = new Set<string>();
    for (const entry of Object.values(newFiles)) for (const o of Object.values(entry.outputs)) currentOutputs.add(o.path);
    currentOutputs.add(modelOut);
    const orphaned: string[] = [];
    for (const prevEntry of Object.values(prevManifest.files)) {
        for (const o of Object.values(prevEntry.outputs)) {
            if (!currentOutputs.has(o.path)) {
                if (!dryRun) await rm(o.path, { force: true });
                orphaned.push(o.path);
            }
        }
    }
    if (prevManifest.index && prevManifest.index.path !== modelOut) {
        if (!dryRun) await rm(prevManifest.index.path, { force: true });
        orphaned.push(prevManifest.index.path);
    }

    // 7. Persist the manifest (skipped under dryRun so the next real compile still has accurate state).
    if (!dryRun) {
        const nextManifest: CacheManifest = {
            version: 1,
            configHash,
            files: newFiles,
            index: { path: modelOut, contentHash: indexContentHash },
        };
        await saveManifest(manifestPath, nextManifest);
    }

    return { inputs, outputs: writtenOutputs, namespaces: namespaceNames, cached: cachedNamespaces, orphaned };
};

/** Like {@link writeIfChanged}, but never touches disk — returns whether a write *would* occur. */
const wouldWrite = async (outPath: string, content: string): Promise<boolean> => {
    try {
        const existing = await readFile(outPath, 'utf8');
        return existing !== content;
    } catch {
        return true;
    }
};

const arrayEquals = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Write `content` to `outPath` only when the current on-disk content differs.
 * Returns `true` iff the file was (re)written, so callers can distinguish
 * touched outputs from no-ops without touching mtimes for free.
 */
const writeIfChanged = async (outPath: string, content: string): Promise<boolean> => {
    try {
        const existing = await readFile(outPath, 'utf8');
        if (existing === content) return false;
    } catch {
        // File doesn't exist — fall through to write.
    }
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, content, 'utf8');
    return true;
};

/**
 * Dynamic-import a generated TypeScript/JavaScript file by absolute path. Wraps
 * the path in a `file://` URL so Node's ESM loader accepts it on every platform.
 * Used by integration tests that round-trip compile → import → exercise the
 * model.
 */
export const importGenerated = (path: string): Promise<unknown> => import(pathToFileURL(path).href);
