/// <reference lib="dom" />
import { parseTuple, type CheckTrace } from '@maroonedsoftware/permissions';
import type {
    DiscoveredCheck,
    ExplainResponse,
    PlaygroundMessage,
    SchemaRelation,
    SchemaSummary,
} from '../../shared/playground.protocol.js';

interface VSCodeAPI {
    postMessage(msg: unknown): void;
    setState(state: unknown): void;
    getState<T>(): T | undefined;
}

declare function acquireVsCodeApi(): VSCodeAPI;

interface UIState {
    relationships: string;
    relationship: string;
    // Structured builder state, persisted so the panel feels stable across reloads.
    relBuilder?: BuilderState;
    chkBuilder?: BuilderState;
}

interface BuilderState {
    objNs?: string;
    objId?: string;
    rel?: string; // relation or permission name
    subNs?: string;
    subId?: string;
    subRel?: string;
    subKind?: 'concrete' | 'wildcard' | 'userset';
}

const vscode = acquireVsCodeApi();
const $ = <T extends Element>(sel: string): T => document.querySelector(sel) as T;

const relsEl = $<HTMLTextAreaElement>('#relationships');
const checkEl = $<HTMLInputElement>('#relationship');
const badgeEl = $<HTMLDivElement>('#badge');
const traceEl = $<HTMLPreElement>('#trace');
const errorEl = $<HTMLDivElement>('#error');
const schemaEl = $<HTMLDivElement>('#schema-summary');

// ─── Persistence ─────────────────────────────────────────────────────────────

let schema: SchemaSummary | undefined;

const persisted: Partial<UIState> = vscode.getState<UIState>() ?? {};
relsEl.value = persisted.relationships ?? '';
checkEl.value = persisted.relationship ?? '';

const relBuilder: BuilderState = { subKind: 'concrete', ...(persisted.relBuilder ?? {}) };
const chkBuilder: BuilderState = { ...(persisted.chkBuilder ?? {}) };

const persist = (): void => {
    vscode.setState({
        relationships: relsEl.value,
        relationship: checkEl.value,
        relBuilder,
        chkBuilder,
    } satisfies UIState);
};

const validationEl = $<HTMLDivElement>('#rel-validation');

/**
 * Per-line validation summary under the relationships textarea. Runs
 * `parseTuple` over each non-blank, non-`#`-prefixed line on every input
 * event — cheap enough at human typing speeds, and surfaces typos before
 * the user clicks Check.
 */
const renderRelValidation = (): void => {
    const lines = relsEl.value.split('\n');
    let valid = 0;
    const failures: Array<{ line: number; message: string }> = [];
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] ?? '';
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        try {
            parseTuple(trimmed);
            valid++;
        } catch (err) {
            failures.push({ line: i + 1, message: err instanceof Error ? err.message : String(err) });
        }
    }

    if (valid === 0 && failures.length === 0) {
        validationEl.className = 'validation muted';
        validationEl.textContent = '';
        return;
    }
    if (failures.length === 0) {
        validationEl.className = 'validation good';
        validationEl.textContent = `✓ ${valid} tuple${valid === 1 ? '' : 's'}`;
        return;
    }
    validationEl.className = 'validation bad';
    const header = `${valid} valid · ${failures.length} invalid`;
    const detail = failures
        .map(f => `  line ${f.line}: ${escape(f.message)}`)
        .join('\n');
    validationEl.innerHTML = `<strong>${header}</strong>\n${detail}`;
};

relsEl.addEventListener('input', () => {
    persist();
    renderRelValidation();
});
checkEl.addEventListener('input', persist);

// ─── Schema helpers ──────────────────────────────────────────────────────────

interface SubjectAllowance {
    namespace: string;
    kinds: Set<'concrete' | 'wildcard' | 'userset'>;
    /** For `userset` subjects: the allowed relation name on `namespace`. */
    usersetRelations: Set<string>;
}

const classifySubjects = (subjects: string[]): Map<string, SubjectAllowance> => {
    const out = new Map<string, SubjectAllowance>();
    const ensure = (ns: string): SubjectAllowance => {
        const cur = out.get(ns);
        if (cur) return cur;
        const created: SubjectAllowance = { namespace: ns, kinds: new Set(), usersetRelations: new Set() };
        out.set(ns, created);
        return created;
    };
    for (const s of subjects) {
        if (s.endsWith('.*')) {
            ensure(s.slice(0, -2)).kinds.add('wildcard');
            continue;
        }
        const dot = s.indexOf('.');
        if (dot !== -1) {
            const a = ensure(s.slice(0, dot));
            a.kinds.add('userset');
            a.usersetRelations.add(s.slice(dot + 1));
            continue;
        }
        ensure(s).kinds.add('concrete');
    }
    return out;
};

const findNamespace = (name: string | undefined) => (name ? schema?.namespaces.find(n => n.name === name) : undefined);
const findRelation = (ns: ReturnType<typeof findNamespace>, name: string | undefined): SchemaRelation | undefined =>
    ns?.relations.find(r => r.name === name);

// ─── Generic select helpers ──────────────────────────────────────────────────

const setOptions = (
    select: HTMLSelectElement,
    options: Array<{ value: string; label?: string; group?: string }>,
    current: string | undefined,
    placeholder: string,
): string | undefined => {
    select.innerHTML = '';
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = placeholder;
    placeholderOpt.disabled = true;
    placeholderOpt.selected = !current;
    select.appendChild(placeholderOpt);

    const groups = new Map<string, HTMLOptGroupElement>();
    for (const opt of options) {
        let parent: HTMLElement = select;
        if (opt.group) {
            let g = groups.get(opt.group);
            if (!g) {
                g = document.createElement('optgroup');
                g.label = opt.group;
                select.appendChild(g);
                groups.set(opt.group, g);
            }
            parent = g;
        }
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label ?? opt.value;
        if (opt.value === current) o.selected = true;
        parent.appendChild(o);
    }
    return options.some(o => o.value === current) ? current : undefined;
};

// ─── Builder rendering ───────────────────────────────────────────────────────

interface BuilderEls {
    objNs: HTMLSelectElement;
    objId: HTMLInputElement;
    rel: HTMLSelectElement;
    subNs: HTMLSelectElement;
    subId: HTMLInputElement;
    subRel: HTMLSelectElement;
    subIdSep: HTMLElement;
    subRelSep: HTMLElement;
    kindToggle?: HTMLElement;
    add?: HTMLButtonElement;
    error?: HTMLDivElement;
}

const relEls: BuilderEls = {
    objNs: $('#rel-obj-ns'),
    objId: $('#rel-obj-id'),
    rel: $('#rel-rel'),
    subNs: $('#rel-sub-ns'),
    subId: $('#rel-sub-id'),
    subRel: $('#rel-sub-rel'),
    subIdSep: $('#rel-builder .sub-id-sep'),
    subRelSep: $('#rel-builder .sub-rel-sep'),
    kindToggle: $('#rel-builder .kind-toggle'),
    add: $('#rel-add'),
    error: $('#rel-builder-error'),
};

const chkEls: BuilderEls = {
    objNs: $('#chk-obj-ns'),
    objId: $('#chk-obj-id'),
    rel: $('#chk-rel'),
    subNs: $('#chk-sub-ns'),
    subId: $('#chk-sub-id'),
    subRel: $('#chk-sub-rel'),
    subIdSep: $('#chk-builder .sub-id-sep') ?? document.createElement('span'),
    subRelSep: $('#chk-builder .sub-rel-sep') ?? document.createElement('span'),
};

// True when we want to render only relations (the `relationships:` builder —
// you can't store a tuple against a permission). The check builder accepts both.
const RELATIONS_ONLY = true;
const RELATIONS_AND_PERMISSIONS = false;

const populateRelationSelect = (
    select: HTMLSelectElement,
    ns: ReturnType<typeof findNamespace>,
    current: string | undefined,
    relationsOnly: boolean,
): string | undefined => {
    if (!ns) return setOptions(select, [], current, '—');
    const options: Array<{ value: string; group?: string }> = [];
    for (const r of ns.relations) options.push({ value: r.name, group: 'Relations' });
    if (!relationsOnly) for (const p of ns.permissions) options.push({ value: p, group: 'Permissions' });
    return setOptions(select, options, current, 'pick…');
};

const namespaceOptions = (): Array<{ value: string }> => (schema?.namespaces ?? []).map(n => ({ value: n.name }));

const renderRelBuilder = (): void => {
    if (!schema || schema.error) {
        relEls.objNs.disabled = true;
        relEls.rel.disabled = true;
        relEls.subNs.disabled = true;
        return;
    }

    relEls.objNs.disabled = false;
    relEls.rel.disabled = false;
    relEls.subNs.disabled = false;

    relBuilder.objNs = setOptions(relEls.objNs, namespaceOptions(), relBuilder.objNs, 'object ns…');
    const objNs = findNamespace(relBuilder.objNs);
    relBuilder.rel = populateRelationSelect(relEls.rel, objNs, relBuilder.rel, RELATIONS_ONLY);

    // Subject allowances depend on the selected relation.
    const relation = findRelation(objNs, relBuilder.rel);
    const allowances = relation ? classifySubjects(relation.subjects) : new Map<string, SubjectAllowance>();
    const subNsOptions = [...allowances.keys()].map(value => ({ value }));
    relBuilder.subNs = setOptions(relEls.subNs, subNsOptions, relBuilder.subNs, 'subject ns…');

    // Kind toggle: enable only the kinds this subject type actually allows.
    const allowance = relBuilder.subNs ? allowances.get(relBuilder.subNs) : undefined;
    const allowed = allowance?.kinds ?? new Set<string>();
    const kindBtns = relEls.kindToggle?.querySelectorAll<HTMLButtonElement>('button[data-kind]') ?? [];
    let firstAllowed: 'concrete' | 'wildcard' | 'userset' | undefined;
    kindBtns.forEach(b => {
        const kind = b.dataset.kind as 'concrete' | 'wildcard' | 'userset';
        const ok = allowed.has(kind);
        b.disabled = !ok;
        if (ok && !firstAllowed) firstAllowed = kind;
        b.classList.toggle('active', kind === relBuilder.subKind);
    });
    if (!allowed.has(relBuilder.subKind ?? 'concrete')) {
        relBuilder.subKind = firstAllowed;
        kindBtns.forEach(b => b.classList.toggle('active', b.dataset.kind === relBuilder.subKind));
    }

    // Show/hide id and relation fields based on kind.
    const kind = relBuilder.subKind ?? 'concrete';
    relEls.subIdSep.hidden = relEls.subId.hidden = kind === 'wildcard';
    relEls.subRelSep.hidden = relEls.subRel.hidden = kind !== 'userset';

    if (kind === 'userset' && allowance) {
        relBuilder.subRel = setOptions(
            relEls.subRel,
            [...allowance.usersetRelations].map(value => ({ value })),
            relBuilder.subRel,
            'rel…',
        );
    }
};

const renderChkBuilder = (): void => {
    if (!schema || schema.error) {
        chkEls.objNs.disabled = true;
        chkEls.rel.disabled = true;
        chkEls.subNs.disabled = true;
        return;
    }
    chkEls.objNs.disabled = false;
    chkEls.rel.disabled = false;
    chkEls.subNs.disabled = false;

    chkBuilder.objNs = setOptions(chkEls.objNs, namespaceOptions(), chkBuilder.objNs, 'object ns…');
    const objNs = findNamespace(chkBuilder.objNs);
    chkBuilder.rel = populateRelationSelect(chkEls.rel, objNs, chkBuilder.rel, RELATIONS_AND_PERMISSIONS);

    // Subject namespace scoping:
    //   - If the user picked a *relation*, scope to the namespaces it declares
    //     as valid subject types — that's exactly what could grant access here.
    //   - If they picked a *permission*, leave it wide open. Permissions
    //     compose over underlying relations and computing the full transitive
    //     subject-namespace set statically isn't worth the complexity.
    const relation = findRelation(objNs, chkBuilder.rel);
    let subNsOpts: Array<{ value: string }>;
    if (relation) {
        const namespaces = [...classifySubjects(relation.subjects).keys()];
        subNsOpts = namespaces.map(value => ({ value }));
    } else {
        subNsOpts = namespaceOptions();
    }
    chkBuilder.subNs = setOptions(chkEls.subNs, subNsOpts, chkBuilder.subNs, 'subject ns…');
};

// ─── Builder → canonical tuple ───────────────────────────────────────────────

const composeRelTuple = (b: BuilderState): { tuple?: string; error?: string } => {
    if (!b.objNs) return { error: 'pick an object namespace' };
    if (!b.objId) return { error: 'enter an object id' };
    if (!b.rel) return { error: 'pick a relation' };
    if (!b.subNs) return { error: 'pick a subject namespace' };
    const kind = b.subKind ?? 'concrete';
    let subject: string;
    if (kind === 'concrete') {
        if (!b.subId) return { error: 'enter a subject id' };
        subject = `${b.subNs}:${b.subId}`;
    } else if (kind === 'wildcard') {
        subject = `${b.subNs}.*`;
    } else {
        if (!b.subId) return { error: 'enter a subject id' };
        if (!b.subRel) return { error: 'pick a subject relation' };
        subject = `${b.subNs}:${b.subId}.${b.subRel}`;
    }
    return { tuple: `${b.objNs}:${b.objId}.${b.rel}@${subject}` };
};

const composeChkTuple = (b: BuilderState): { tuple?: string; error?: string } => {
    if (!b.objNs) return { error: 'pick an object namespace' };
    if (!b.objId) return { error: 'enter an object id' };
    if (!b.rel) return { error: 'pick a relation or permission' };
    if (!b.subNs) return { error: 'pick a subject namespace' };
    if (!b.subId) return { error: 'enter a subject id' };
    return { tuple: `${b.objNs}:${b.objId}.${b.rel}@${b.subNs}:${b.subId}` };
};

// ─── Builder event wiring ────────────────────────────────────────────────────

const bind = (el: HTMLElement, ev: string, fn: () => void): void => el.addEventListener(ev, fn);

const onRelBuilderChange = (): void => {
    relBuilder.objNs = relEls.objNs.value || undefined;
    relBuilder.objId = relEls.objId.value || undefined;
    relBuilder.rel = relEls.rel.value || undefined;
    relBuilder.subNs = relEls.subNs.value || undefined;
    relBuilder.subId = relEls.subId.value || undefined;
    relBuilder.subRel = relEls.subRel.value || undefined;
    renderRelBuilder();
    if (relEls.error) relEls.error.textContent = '';
    persist();
};

bind(relEls.objNs, 'change', onRelBuilderChange);
bind(relEls.objId, 'input', onRelBuilderChange);
bind(relEls.rel, 'change', onRelBuilderChange);
bind(relEls.subNs, 'change', onRelBuilderChange);
bind(relEls.subId, 'input', onRelBuilderChange);
bind(relEls.subRel, 'change', onRelBuilderChange);

relEls.kindToggle?.querySelectorAll<HTMLButtonElement>('button[data-kind]').forEach(btn => {
    bind(btn, 'click', () => {
        if (btn.disabled) return;
        relBuilder.subKind = btn.dataset.kind as 'concrete' | 'wildcard' | 'userset';
        renderRelBuilder();
        persist();
    });
});

relEls.add?.addEventListener('click', () => {
    const { tuple, error } = composeRelTuple(relBuilder);
    if (relEls.error) relEls.error.textContent = error ?? '';
    if (!tuple) return;
    const sep = relsEl.value && !relsEl.value.endsWith('\n') ? '\n' : '';
    relsEl.value = `${relsEl.value}${sep}${tuple}\n`;
    relsEl.scrollTop = relsEl.scrollHeight;
    // Clear the id fields so the user can stamp out a few in a row without
    // re-picking the dropdowns each time.
    relBuilder.objId = relEls.objId.value = '';
    relBuilder.subId = relEls.subId.value = '';
    persist();
    renderRelValidation();
});

const onChkBuilderChange = (): void => {
    chkBuilder.objNs = chkEls.objNs.value || undefined;
    chkBuilder.objId = chkEls.objId.value || undefined;
    chkBuilder.rel = chkEls.rel.value || undefined;
    chkBuilder.subNs = chkEls.subNs.value || undefined;
    chkBuilder.subId = chkEls.subId.value || undefined;
    renderChkBuilder();
    // Mirror the composed tuple into the raw input so power users always see
    // what's about to be sent.
    const composed = composeChkTuple(chkBuilder);
    if (composed.tuple) checkEl.value = composed.tuple;
    persist();
};

bind(chkEls.objNs, 'change', onChkBuilderChange);
bind(chkEls.objId, 'input', onChkBuilderChange);
bind(chkEls.rel, 'change', onChkBuilderChange);
bind(chkEls.subNs, 'change', onChkBuilderChange);
bind(chkEls.subId, 'input', onChkBuilderChange);

// Reflect initial persisted values into the DOM before the first render.
relEls.objId.value = relBuilder.objId ?? '';
relEls.subId.value = relBuilder.subId ?? '';
chkEls.objId.value = chkBuilder.objId ?? '';
chkEls.subId.value = chkBuilder.subId ?? '';

// ─── Schema summary rendering ────────────────────────────────────────────────

const renderSchemaSummary = (summary: SchemaSummary): void => {
    schema = summary;
    if (summary.error) {
        schemaEl.innerHTML = `<span class="bad">schema error:</span> ${escape(summary.error.message)}`;
    } else {
        // Side panel shows locally-declared namespaces only — sibling ones
        // come from other files and would clutter this view. They still
        // populate the builder dropdowns.
        const local = summary.namespaces.filter(ns => ns.local);
        if (local.length === 0) {
            schemaEl.innerHTML = '<span class="muted">no namespaces declared</span>';
        } else {
            schemaEl.innerHTML = local
                .map(
                    ns =>
                        `<div class="ns"><strong>${escape(ns.name)}</strong>` +
                        (ns.relations.length ? ` <span class="muted">relations:</span> ${ns.relations.map(r => escape(r.name)).join(', ')}` : '') +
                        (ns.permissions.length ? ` <span class="muted">permissions:</span> ${ns.permissions.map(escape).join(', ')}` : '') +
                        `</div>`,
                )
                .join('');
        }
    }
    renderRelBuilder();
    renderChkBuilder();
};

// ─── Result rendering (unchanged from before) ────────────────────────────────

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

// ─── Check button ───────────────────────────────────────────────────────────

/**
 * Run the active check input and render both the verdict and the trace. The
 * trace is always requested — short-circuiting just to skip rendering would
 * trade the playground's main value for a few microseconds on an in-memory
 * repo, and we never want to be in the position of "ALLOWED but I can't
 * tell you why".
 */
const runCheck = (): void => {
    const composed = composeChkTuple(chkBuilder);
    const relationship = (composed.tuple ?? checkEl.value).trim();
    if (!relationship) {
        renderResult({ allowed: false, error: 'compose a check or fill the raw field' });
        return;
    }
    const msg: PlaygroundMessage = {
        kind: 'requestCheck',
        relationships: relsEl.value,
        relationship,
        explain: true,
    };
    vscode.postMessage(msg);
};

$<HTMLButtonElement>('#check').addEventListener('click', runCheck);

// Pressing Enter inside any check-builder field or the raw input runs the
// check — common form-style ergonomic.
const enterRuns = (el: HTMLElement): void => {
    el.addEventListener('keydown', evt => {
        if ((evt as KeyboardEvent).key === 'Enter') {
            evt.preventDefault();
            runCheck();
        }
    });
};
enterRuns(chkEls.objId);
enterRuns(chkEls.subId);
enterRuns(checkEl);

// ─── Toolbar: seed / load / save ─────────────────────────────────────────────

const toolbarStatusEl = $<HTMLSpanElement>('#toolbar-status');

/**
 * Friendly placeholder ids per common namespace name — so seeded tuples read
 * like real test data (`user:alice`) instead of generic `user1`. Falls back
 * to `<ns>1` for unknown namespaces.
 */
const FRIENDLY_IDS: Record<string, string[]> = {
    user: ['alice', 'bob', 'carol'],
    org: ['acme', 'globex'],
    team: ['backend', 'frontend'],
    group: ['admins', 'engineers'],
    folder: ['eng', 'product'],
    doc: ['readme', 'spec'],
    document: ['readme', 'spec'],
    file: ['readme', 'spec'],
    account: ['main', 'savings'],
    project: ['apollo', 'phoenix'],
    ledger: ['ledger1', 'ledger2'],
    counterparty: ['acme', 'globex'],
};
const idFor = (ns: string, n: number): string => {
    const list = FRIENDLY_IDS[ns];
    return list ? list[n % list.length]! : `${ns}${n + 1}`;
};

const pickSubject = (
    subjects: string[],
): { ns: string; kind: 'concrete' | 'wildcard' | 'userset'; rel?: string } | undefined => {
    for (const s of subjects) {
        if (!s.includes('.')) return { ns: s, kind: 'concrete' };
    }
    for (const s of subjects) {
        if (!s.endsWith('.*')) {
            const dot = s.indexOf('.');
            return { ns: s.slice(0, dot), kind: 'userset', rel: s.slice(dot + 1) };
        }
    }
    for (const s of subjects) {
        if (s.endsWith('.*')) return { ns: s.slice(0, -2), kind: 'wildcard' };
    }
    return undefined;
};

const seedFromSchema = (): void => {
    if (!schema || schema.error) {
        toolbarStatusEl.textContent = 'no schema to seed from';
        return;
    }
    const lines: string[] = [];
    for (const ns of schema.namespaces) {
        if (!ns.local || ns.relations.length === 0) continue;
        const objId = idFor(ns.name, 0);
        for (const rel of ns.relations) {
            const sub = pickSubject(rel.subjects);
            if (!sub) continue;
            let subStr: string;
            if (sub.kind === 'concrete') subStr = `${sub.ns}:${idFor(sub.ns, 0)}`;
            else if (sub.kind === 'wildcard') subStr = `${sub.ns}.*`;
            else subStr = `${sub.ns}:${idFor(sub.ns, 0)}.${sub.rel}`;
            lines.push(`${ns.name}:${objId}.${rel.name}@${subStr}`);
        }
    }
    if (lines.length === 0) {
        toolbarStatusEl.textContent = 'no relations found in local namespaces';
        return;
    }
    const sep = relsEl.value && !relsEl.value.endsWith('\n') ? '\n' : '';
    relsEl.value = `${relsEl.value}${sep}# seeded from schema\n${lines.join('\n')}\n`;
    relsEl.scrollTop = relsEl.scrollHeight;
    toolbarStatusEl.textContent = `seeded ${lines.length} tuple${lines.length === 1 ? '' : 's'}`;
    persist();
    renderRelValidation();
};

$<HTMLButtonElement>('#seed').addEventListener('click', seedFromSchema);
$<HTMLButtonElement>('#load-fixture').addEventListener('click', () => {
    toolbarStatusEl.textContent = '';
    vscode.postMessage({ kind: 'requestLoadFixture' } satisfies PlaygroundMessage);
});
$<HTMLButtonElement>('#save-fixture').addEventListener('click', () => {
    toolbarStatusEl.textContent = '';
    const composed = composeChkTuple(chkBuilder);
    vscode.postMessage({
        kind: 'requestSaveFixture',
        relationships: relsEl.value,
        check: composed.tuple ?? (checkEl.value.trim() || undefined),
    } satisfies PlaygroundMessage);
});

// ─── Discover checks ─────────────────────────────────────────────────────────

const discoverPanelEl = $<HTMLDivElement>('#discover-panel');
const discoverListEl = $<HTMLUListElement>('#discover-list');

$<HTMLButtonElement>('#discover').addEventListener('click', () => {
    toolbarStatusEl.textContent = 'scanning workspace…';
    discoverListEl.innerHTML = '';
    discoverPanelEl.hidden = false;
    vscode.postMessage({ kind: 'requestDiscoverChecks' } satisfies PlaygroundMessage);
});

$<HTMLButtonElement>('#discover-close').addEventListener('click', () => {
    discoverPanelEl.hidden = true;
});

const shortenPath = (full: string): string => {
    const parts = full.split('/');
    return parts.slice(-3).join('/');
};

const applyDiscovered = (site: DiscoveredCheck): void => {
    // The discovered call site gives us the permission name and (sometimes)
    // the object namespace. Push those into the check builder so the user
    // only needs to fill in the ids.
    if (site.namespace) chkBuilder.objNs = site.namespace;
    if (site.permission) chkBuilder.rel = site.permission;
    chkBuilder.objId = undefined;
    chkBuilder.subId = undefined;
    chkBuilder.subNs = undefined;
    // Re-sync DOM state from builder.
    chkEls.objId.value = '';
    chkEls.subId.value = '';
    renderChkBuilder();
    const composed = composeChkTuple(chkBuilder);
    if (composed.tuple) checkEl.value = composed.tuple;
    persist();
    discoverPanelEl.hidden = true;
    const label = site.permission ?? '(dynamic)';
    toolbarStatusEl.textContent = `loaded ${label} from ${shortenPath(site.file)}:${site.line}`;
};

const renderDiscovered = (sites: DiscoveredCheck[], error?: string): void => {
    discoverListEl.innerHTML = '';
    if (error) {
        const li = document.createElement('li');
        li.className = 'discover-row bad';
        li.textContent = error;
        discoverListEl.appendChild(li);
        toolbarStatusEl.textContent = '';
        return;
    }
    if (sites.length === 0) {
        const li = document.createElement('li');
        li.className = 'discover-row muted';
        li.textContent = 'no check() call sites found';
        discoverListEl.appendChild(li);
        toolbarStatusEl.textContent = '';
        return;
    }
    for (const site of sites) {
        const li = document.createElement('li');
        li.className = 'discover-row';
        const head = document.createElement('div');
        head.className = 'discover-row-head';
        const labelParts: string[] = [];
        if (site.namespace) labelParts.push(site.namespace);
        if (site.permission) labelParts.push(site.permission);
        const label = labelParts.length ? labelParts.join('.') : '(dynamic)';
        head.innerHTML = `<strong>${escape(label)}</strong> <span class="muted">${escape(shortenPath(site.file))}:${site.line}</span>`;
        const snippet = document.createElement('code');
        snippet.className = 'discover-snippet';
        snippet.textContent = site.snippet;
        li.appendChild(head);
        li.appendChild(snippet);
        li.addEventListener('click', () => applyDiscovered(site));
        discoverListEl.appendChild(li);
    }
    toolbarStatusEl.textContent = `found ${sites.length} call site${sites.length === 1 ? '' : 's'}`;
};

// ─── LSP message intake ──────────────────────────────────────────────────────

window.addEventListener('message', evt => {
    const msg = evt.data as PlaygroundMessage | { kind: 'schemaSummary'; summary: SchemaSummary };
    if (msg.kind === 'checkResult') renderResult(msg.response);
    else if (msg.kind === 'schemaSummary') renderSchemaSummary(msg.summary);
    else if (msg.kind === 'fixtureLoaded') {
        relsEl.value = msg.relationships;
        if (msg.check) checkEl.value = msg.check;
        persist();
        renderRelValidation();
        toolbarStatusEl.textContent = msg.check ? 'fixture loaded (check input updated)' : 'fixture loaded';
    } else if (msg.kind === 'fixtureSaved') {
        toolbarStatusEl.textContent = `saved → ${msg.path}`;
    } else if (msg.kind === 'fixtureError') {
        toolbarStatusEl.textContent = msg.message;
    } else if (msg.kind === 'discoveredChecks') {
        renderDiscovered(msg.response.sites, msg.response.error);
    }
});

renderRelValidation();

vscode.postMessage({ kind: 'ready' } satisfies PlaygroundMessage);
