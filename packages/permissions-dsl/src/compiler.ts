import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { glob } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderIndex, renderNamespace } from './codegen.js';
import { lower } from './lower.js';
import { parse } from './parser.js';
import { CompileError } from './diagnostics.js';
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
    file: FileNode;
}

/** Result of a successful {@link compile} run — absolute paths and namespace names. */
export interface CompileResult {
    /** Absolute paths of every `.perm` file that was read. */
    inputs: string[];
    /** Absolute paths of every TypeScript file that was written (per-namespace files + the aggregate model). */
    outputs: string[];
    /** Names of the namespaces declared across all inputs, in encounter order. */
    namespaces: string[];
}

/**
 * Compile every `.perm` file matched by `config.patterns` into TypeScript.
 * Pipeline: discover → parse → cross-file duplicate-namespace check → per-file
 * semantic validation (with sibling namespaces visible) → codegen → optional
 * prettier pass → write.
 *
 * Output: one file per namespace at `output.namespace` (with `{filename}`
 * replaced by the namespace name) plus an aggregate `output.model` file that
 * re-exports the namespaces and constructs an `AuthorizationModel`.
 *
 * @throws {CompileError} for grammar errors, duplicate or unknown names,
 *   tupleToUserset references that don't resolve, or invalid models.
 * @throws {Error} if no files match `patterns`.
 */
export const compile = async (config: PermissionsConfig): Promise<CompileResult> => {
    const inputs = await expandPatterns(config);
    if (inputs.length === 0) {
        throw new Error(`no files matched patterns: ${config.patterns.join(', ')}`);
    }

    // 1. Parse every file.
    const parsed: ParsedFile[] = [];
    for (const filename of inputs) {
        const source = await readFile(filename, 'utf8');
        const file = parse({ source, filename });
        parsed.push({ filename, source, file });
    }

    // 2. Cross-file: detect duplicate namespaces (point at the second occurrence).
    const firstSeen = new Map<string, ParsedFile>();
    for (const p of parsed) {
        for (const ns of p.file.namespaces) {
            const prior = firstSeen.get(ns.name);
            if (prior && prior.filename !== p.filename) {
                throw new CompileError({
                    source: p.source,
                    filename: p.filename,
                    span: ns.nameLoc,
                    message: `duplicate namespace '${ns.name}' (also declared in ${prior.filename})`,
                });
            }
            if (!prior) firstSeen.set(ns.name, p);
        }
    }

    // 3. Per-file validation — each file sees its own namespaces plus all others by name
    //    via a merged namespace list. Diagnostics reference local nodes only, so spans
    //    always belong to the file being validated.
    const allNamespaces: NamespaceNode[] = parsed.flatMap(p => p.file.namespaces);
    for (const p of parsed) {
        const ownNames = new Set(p.file.namespaces.map(n => n.name));
        const others = allNamespaces.filter(n => !ownNames.has(n.name));
        const mergedFile: FileNode = {
            kind: 'file',
            loc: p.file.loc,
            namespaces: [...p.file.namespaces, ...others],
        };
        lower(mergedFile, { source: p.source, filename: p.filename });
    }

    // 4. Codegen — one TS file per namespace + an aggregate index.
    const outputs: string[] = [];
    const namespaceNames: string[] = [];
    const namespaceImports: { name: string; from: string }[] = [];
    const modelOut = resolveModelOutput(config);

    for (const ns of allNamespaces) {
        const file = renderNamespace(ns, { permissionsImport: config.permissionsImport });
        const outPath = resolveNamespaceOutput(config, ns.name);
        const formatted = config.prettier ? await formatWithPrettier(file.source, outPath) : file.source;
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, formatted, 'utf8');
        outputs.push(outPath);
        namespaceNames.push(ns.name);
        namespaceImports.push({ name: ns.name, from: importSpecifierFor(modelOut, outPath) });
    }

    const indexSrc = renderIndex({ permissionsImport: config.permissionsImport, namespaceImports });
    const formattedIndex = config.prettier ? await formatWithPrettier(indexSrc, modelOut) : indexSrc;
    await mkdir(dirname(modelOut), { recursive: true });
    await writeFile(modelOut, formattedIndex, 'utf8');
    outputs.push(modelOut);

    return { inputs, outputs, namespaces: namespaceNames };
};

/**
 * Dynamic-import a generated TypeScript/JavaScript file by absolute path. Wraps
 * the path in a `file://` URL so Node's ESM loader accepts it on every platform.
 * Used by integration tests that round-trip compile → import → exercise the
 * model.
 */
export const importGenerated = (path: string): Promise<unknown> => import(pathToFileURL(path).href);
