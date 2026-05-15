import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { sep as pathSep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parse, type FileNode, type NamespaceNode } from '@maroonedsoftware/permissions-dsl';

interface Entry {
    source: string;
    namespaces: NamespaceNode[];
}

const parseSilently = (source: string, filename: string): FileNode | undefined => {
    try {
        return parse({ source, filename });
    } catch {
        return undefined;
    }
};

const uriToPath = (uri: string): string => {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
};

const pathToUri = (path: string): string => pathToFileURL(path).href;

export class WorkspaceIndex {
    private readonly entries = new Map<string, Entry>();

    async initialScan(folders: string[]): Promise<void> {
        for (const folder of folders) {
            for await (const match of glob('**/*.perm', { cwd: folder })) {
                if (match.includes(`node_modules${pathSep}`) || match.includes(`.git${pathSep}`) || match.includes(`dist${pathSep}`)) continue;
                await this.updateFromDisk(pathToUri(`${folder}/${match}`));
            }
        }
    }

    updateFromText(uri: string, source: string): void {
        const file = parseSilently(source, uriToPath(uri));
        if (!file) {
            // Retain prior entry so transient syntax errors don't blow away cross-file resolution.
            return;
        }
        this.entries.set(uri, { source, namespaces: file.namespaces });
    }

    async updateFromDisk(uri: string): Promise<void> {
        try {
            const source = await readFile(uriToPath(uri), 'utf8');
            this.updateFromText(uri, source);
        } catch {
            // File unreadable — leave the prior entry alone.
        }
    }

    remove(uri: string): void {
        this.entries.delete(uri);
    }

    /**
     * Namespaces from every indexed file except `currentUri`. Deduped by name —
     * first occurrence wins. Cross-file duplicate-namespace errors are a separate
     * concern (the CLI compiler raises them; the LSP currently leaves them to
     * the per-file local-duplicate check).
     */
    siblings(currentUri: string): NamespaceNode[] {
        const seen = new Set<string>();
        const out: NamespaceNode[] = [];
        for (const [uri, entry] of this.entries) {
            if (uri === currentUri) continue;
            for (const ns of entry.namespaces) {
                if (seen.has(ns.name)) continue;
                seen.add(ns.name);
                out.push(ns);
            }
        }
        return out;
    }
}
