import type { CheckTrace } from '@maroonedsoftware/permissions';
import type { ExplainResponse, PlaygroundMessage } from '../../shared/playground.protocol.js';

interface VSCodeAPI {
    postMessage(msg: unknown): void;
    setState(state: unknown): void;
    getState<T>(): T | undefined;
}

declare function acquireVsCodeApi(): VSCodeAPI;

interface UIState {
    relationships: string;
    relationship: string;
}

const vscode = acquireVsCodeApi();
const $ = <T extends Element>(sel: string): T => document.querySelector(sel) as T;

const relsEl = $<HTMLTextAreaElement>('#relationships');
const checkEl = $<HTMLInputElement>('#relationship');
const badgeEl = $<HTMLDivElement>('#badge');
const traceEl = $<HTMLPreElement>('#trace');
const errorEl = $<HTMLDivElement>('#error');
const schemaEl = $<HTMLDivElement>('#schema-summary');

const persisted = vscode.getState<UIState>();
if (persisted) {
    relsEl.value = persisted.relationships ?? '';
    checkEl.value = persisted.relationship ?? '';
}

const persist = (): void => {
    vscode.setState({ relationships: relsEl.value, relationship: checkEl.value } satisfies UIState);
};
relsEl.addEventListener('input', persist);
checkEl.addEventListener('input', persist);

const renderSchemaSummary = (summary: { namespaces: Array<{ name: string; relations: string[]; permissions: string[] }>; error?: { message: string } }): void => {
    if (summary.error) {
        schemaEl.innerHTML = `<span class="bad">schema error:</span> ${escape(summary.error.message)}`;
        return;
    }
    if (summary.namespaces.length === 0) {
        schemaEl.innerHTML = '<span class="muted">no namespaces declared</span>';
        return;
    }
    schemaEl.innerHTML = summary.namespaces
        .map(
            ns =>
                `<div class="ns"><strong>${escape(ns.name)}</strong>` +
                (ns.relations.length ? ` <span class="muted">relations:</span> ${ns.relations.map(escape).join(', ')}` : '') +
                (ns.permissions.length ? ` <span class="muted">permissions:</span> ${ns.permissions.map(escape).join(', ')}` : '') +
                `</div>`,
        )
        .join('');
};

const renderResult = (response: ExplainResponse): void => {
    errorEl.textContent = '';
    if (response.error) {
        badgeEl.className = 'badge bad';
        badgeEl.textContent = 'ERROR';
        traceEl.textContent = '';
        errorEl.textContent = response.error;
        return;
    }
    badgeEl.className = `badge ${response.allowed ? 'good' : 'bad'}`;
    badgeEl.textContent = response.allowed ? 'ALLOWED' : 'DENIED';
    traceEl.textContent = response.trace ? renderTrace(response.trace, 0) : '';
};

const renderTrace = (trace: CheckTrace, indent: number): string => {
    const pad = '  '.repeat(indent);
    const mark = trace.allowed ? '✓' : '✗';
    switch (trace.kind) {
        case 'direct': {
            const head = `${pad}${mark} direct ${trace.object.namespace}:${trace.object.id}.${trace.relation} (${trace.tuplesExamined.length} tuple${trace.tuplesExamined.length === 1 ? '' : 's'})`;
            const parts: string[] = [head];
            if (trace.matched) {
                const s = trace.matched.subject;
                const sub = s.kind === 'concrete' ? `${s.namespace}:${s.id}` : s.kind === 'wildcard' ? `${s.namespace}.*` : `${s.namespace}:${s.id}.${s.relation}`;
                parts.push(`${pad}  via ${sub}`);
            }
            if (trace.usersetChild) parts.push(renderTrace(trace.usersetChild, indent + 2));
            return parts.join('\n');
        }
        case 'computed':
            return `${pad}${mark} computed → ${trace.relation}\n${renderTrace(trace.child, indent + 1)}`;
        case 'tupleToUserset': {
            const head = `${pad}${mark} ${trace.tupleRelation}->${trace.computedRelation} (${trace.parents.length} parent${trace.parents.length === 1 ? '' : 's'})`;
            if (trace.parents.length === 0) return head;
            return `${head}\n${trace.parents.map(p => `${pad}  via ${p.parent.namespace}:${p.parent.id}\n${renderTrace(p.trace, indent + 2)}`).join('\n')}`;
        }
        case 'union':
            return `${pad}${mark} union\n${trace.children.map(c => renderTrace(c, indent + 1)).join('\n')}`;
        case 'intersection':
            return `${pad}${mark} intersection\n${trace.children.map(c => renderTrace(c, indent + 1)).join('\n')}`;
        case 'exclusion':
            return `${pad}${mark} exclusion\n${pad}  base:\n${renderTrace(trace.base, indent + 2)}\n${pad}  subtract:\n${renderTrace(trace.subtract, indent + 2)}`;
        case 'cycle':
            return `${pad}✗ cycle at ${trace.key}`;
        case 'maxDepth':
            return `${pad}✗ max depth (${trace.depth}) exceeded`;
        case 'cached':
            return `${pad}${mark} cached ${trace.key}`;
    }
};

const escape = (s: string): string =>
    s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const request = (explain: boolean): void => {
    const msg: PlaygroundMessage = {
        kind: 'requestCheck',
        relationships: relsEl.value,
        relationship: checkEl.value.trim(),
        explain,
    };
    vscode.postMessage(msg);
};

$<HTMLButtonElement>('#check').addEventListener('click', () => request(false));
$<HTMLButtonElement>('#explain').addEventListener('click', () => request(true));

window.addEventListener('message', evt => {
    const msg = evt.data as PlaygroundMessage | { kind: 'schemaSummary'; summary: Parameters<typeof renderSchemaSummary>[0] };
    if (msg.kind === 'checkResult') renderResult(msg.response);
    else if (msg.kind === 'schemaSummary') renderSchemaSummary(msg.summary);
});

vscode.postMessage({ kind: 'ready' } satisfies PlaygroundMessage);
