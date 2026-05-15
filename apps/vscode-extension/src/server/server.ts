import { fileURLToPath } from 'node:url';
import {
    createConnection,
    DiagnosticSeverity,
    DocumentSymbol,
    ProposedFeatures,
    SymbolKind,
    TextDocumentSyncKind,
    TextDocuments,
    type Diagnostic,
    type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompileError, lower, parse, type FileNode, type MemberNode, type NamespaceNode } from '@maroonedsoftware/permissions-dsl';
import {
    check,
    explain,
    InMemoryTupleRepository,
    parseTuple,
    type RelationTuple,
} from '@maroonedsoftware/permissions';
import { spanToRange } from '../shared/offset.js';
import {
    PlaygroundMethods,
    type CheckRequest,
    type CheckResponse,
    type ExplainResponse,
    type SchemaSummary,
} from '../shared/playground.protocol.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const uriToFilename = (uri: string): string => {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
};

const compileError = (text: string, filename: string): CompileError | undefined => {
    try {
        const file = parse({ source: text, filename });
        lower(file, { source: text, filename });
        return undefined;
    } catch (err) {
        if (err instanceof CompileError) return err;
        throw err;
    }
};

const validate = (doc: TextDocument): void => {
    const text = doc.getText();
    const filename = uriToFilename(doc.uri);
    const diagnostics: Diagnostic[] = [];
    const err = compileError(text, filename);
    if (err) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: spanToRange(text, err.span),
            message: err.message.replace(/^.*?error:\s*/m, '').split('\n')[0] ?? err.message,
            source: 'pdsl',
        });
    }
    void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
};

const parseSilently = (text: string, filename: string): FileNode | undefined => {
    try {
        return parse({ source: text, filename });
    } catch {
        return undefined;
    }
};

const memberSymbol = (text: string, member: MemberNode): DocumentSymbol => ({
    name: member.name,
    detail: member.kind === 'relation' ? 'relation' : 'permission',
    kind: member.kind === 'relation' ? SymbolKind.Field : SymbolKind.Function,
    range: spanToRange(text, member.loc),
    selectionRange: spanToRange(text, member.nameLoc),
});

const namespaceSymbol = (text: string, ns: NamespaceNode): DocumentSymbol => ({
    name: ns.name,
    detail: 'namespace',
    kind: SymbolKind.Namespace,
    range: spanToRange(text, ns.loc),
    selectionRange: spanToRange(text, ns.nameLoc),
    children: ns.members.map(m => memberSymbol(text, m)),
});

connection.onInitialize(
    (): InitializeResult => ({
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            documentSymbolProvider: true,
        },
    }),
);

documents.onDidChangeContent(change => validate(change.document));
documents.onDidOpen(change => validate(change.document));
documents.onDidClose(change => {
    void connection.sendDiagnostics({ uri: change.document.uri, diagnostics: [] });
});

connection.onDocumentSymbol(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const text = doc.getText();
    const file = parseSilently(text, uriToFilename(doc.uri));
    if (!file) return [];
    return file.namespaces.map(ns => namespaceSymbol(text, ns));
});

const buildSchemaSummary = (schema: string, filename: string): SchemaSummary => {
    try {
        const file = parse({ source: schema, filename });
        const { namespaces } = lower(file, { source: schema, filename });
        return {
            namespaces: namespaces.map(ns => ({
                name: ns.name,
                relations: Object.keys(ns.relations),
                permissions: Object.keys(ns.permissions),
            })),
        };
    } catch (err) {
        if (err instanceof CompileError) {
            return {
                namespaces: [],
                error: { message: err.message.replace(/^.*?error:\s*/m, '').split('\n')[0] ?? err.message },
            };
        }
        return { namespaces: [], error: { message: err instanceof Error ? err.message : String(err) } };
    }
};

const loadRequest = (req: CheckRequest): { repo: InMemoryTupleRepository; tuples: RelationTuple[]; checkTuple: RelationTuple; model: ReturnType<typeof lower>['model'] } => {
    const schemaFilename = req.schemaFilename ?? '<playground>';
    const ast = parse({ source: req.schema, filename: schemaFilename });
    const { model } = lower(ast, { source: req.schema, filename: schemaFilename });

    const tuples: RelationTuple[] = [];
    const lines = req.relationships.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        try {
            tuples.push(parseTuple(trimmed));
        } catch (err) {
            throw new Error(`relationships line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const repo = new InMemoryTupleRepository(tuples);
    const checkTuple = parseTuple(req.relationship);
    return { repo, tuples, checkTuple, model };
};

connection.onRequest(PlaygroundMethods.LoadSchema, (params: { schema: string; schemaFilename?: string }): SchemaSummary => {
    return buildSchemaSummary(params.schema, params.schemaFilename ?? '<playground>');
});

connection.onRequest(PlaygroundMethods.Check, async (params: CheckRequest): Promise<CheckResponse> => {
    try {
        const { repo, tuples, checkTuple, model } = loadRequest(params);
        const allowed = await check(model, repo, checkTuple.object, checkTuple.relation, checkTuple.subject);
        return {
            allowed,
            loadedRelationships: tuples,
            parsedCheck: { object: checkTuple.object, relation: checkTuple.relation, subject: checkTuple.subject },
        };
    } catch (err) {
        return { allowed: false, error: err instanceof Error ? err.message : String(err) };
    }
});

connection.onRequest(PlaygroundMethods.Explain, async (params: CheckRequest): Promise<ExplainResponse> => {
    try {
        const { repo, tuples, checkTuple, model } = loadRequest(params);
        const result = await explain(model, repo, checkTuple.object, checkTuple.relation, checkTuple.subject);
        return {
            allowed: result.allowed,
            trace: result.trace,
            loadedRelationships: tuples,
            parsedCheck: { object: checkTuple.object, relation: checkTuple.relation, subject: checkTuple.subject },
        };
    } catch (err) {
        return { allowed: false, error: err instanceof Error ? err.message : String(err) };
    }
});

documents.listen(connection);
connection.listen();
