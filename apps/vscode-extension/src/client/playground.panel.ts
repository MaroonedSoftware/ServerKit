import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import {
    PlaygroundMethods,
    type CheckRequest,
    type ExplainResponse,
    type PlaygroundMessage,
    type SchemaSummary,
} from '../shared/playground.protocol.js';

const PANEL_VIEW_TYPE = 'serverkit.permissions.playground';

/**
 * Singleton webview manager for the permissions playground. The panel is
 * bound to whichever `.perm` document is active when it's opened; subsequent
 * edits to that document re-flow into the panel automatically.
 */
export class PlaygroundPanel {
    private static current: PlaygroundPanel | undefined;

    public static show(context: vscode.ExtensionContext, client: LanguageClient): void {
        const editor = vscode.window.activeTextEditor;
        const column = editor?.viewColumn ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

        if (PlaygroundPanel.current) {
            PlaygroundPanel.current.panel.reveal(column);
            void PlaygroundPanel.current.refreshFromActiveEditor();
            return;
        }

        const panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Permissions Playground', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(context.asAbsolutePath(path.join('dist', 'client', 'playground')))],
        });

        PlaygroundPanel.current = new PlaygroundPanel(panel, context, client);
    }

    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
        private readonly client: LanguageClient,
    ) {
        panel.webview.html = this.renderHtml();
        panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

        panel.webview.onDidReceiveMessage(
            (msg: PlaygroundMessage) => this.handleMessage(msg),
            undefined,
            this.disposables,
        );

        vscode.workspace.onDidChangeTextDocument(
            e => {
                if (this.isTrackedDocument(e.document)) void this.refreshFromActiveEditor(e.document);
            },
            undefined,
            this.disposables,
        );
        vscode.window.onDidChangeActiveTextEditor(
            () => void this.refreshFromActiveEditor(),
            undefined,
            this.disposables,
        );
    }

    private isTrackedDocument(doc: vscode.TextDocument): boolean {
        return doc.languageId === 'serverkit-permissions';
    }

    private async refreshFromActiveEditor(doc?: vscode.TextDocument): Promise<void> {
        const source = doc ?? this.findPermDocument();
        if (!source) return;
        const schema = source.getText();
        const schemaFilename = source.fileName || '<playground>';
        await this.send({ kind: 'schemaUpdated', schema, schemaFilename });
        const summary = await this.client.sendRequest<SchemaSummary>(PlaygroundMethods.LoadSchema, {
            schema,
            schemaFilename,
        });
        await this.send({
            kind: 'checkResult',
            response: { allowed: false, error: summary.error?.message ?? undefined },
        } satisfies PlaygroundMessage);
        await this.panel.webview.postMessage({ kind: 'schemaSummary', summary });
    }

    private findPermDocument(): vscode.TextDocument | undefined {
        const active = vscode.window.activeTextEditor?.document;
        if (active && this.isTrackedDocument(active)) return active;
        return vscode.workspace.textDocuments.find(d => this.isTrackedDocument(d));
    }

    private async handleMessage(msg: PlaygroundMessage): Promise<void> {
        if (msg.kind === 'ready') {
            await this.refreshFromActiveEditor();
            return;
        }
        if (msg.kind === 'requestCheck') {
            const source = this.findPermDocument();
            if (!source) {
                await this.send({
                    kind: 'checkResult',
                    response: { allowed: false, error: 'open a .perm file to evaluate against' },
                });
                return;
            }
            const req: CheckRequest = {
                schema: source.getText(),
                schemaFilename: source.fileName,
                relationships: msg.relationships,
                relationship: msg.relationship,
            };
            const method = msg.explain ? PlaygroundMethods.Explain : PlaygroundMethods.Check;
            const response = await this.client.sendRequest<ExplainResponse>(method, req);
            await this.send({ kind: 'checkResult', response });
        }
    }

    private send(msg: PlaygroundMessage | { kind: string; [k: string]: unknown }): Thenable<boolean> {
        return this.panel.webview.postMessage(msg);
    }

    private renderHtml(): string {
        const webview = this.panel.webview;
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(this.context.asAbsolutePath(path.join('dist', 'client', 'playground', 'webview.js'))),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(this.context.asAbsolutePath(path.join('dist', 'client', 'playground', 'webview.css'))),
        );
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};`;
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${styleUri}" />
<title>Permissions Playground</title>
</head>
<body>
<header>
  <h1>Permissions Playground</h1>
  <p class="hint">Edit relationships and a check input below — results update against the active <code>.perm</code> schema.</p>
</header>
<main>
  <section class="schema">
    <h2>Schema</h2>
    <div id="schema-summary" class="muted">no .perm file open</div>
  </section>
  <section class="input">
    <label>Relationships (one tuple per line)</label>
    <textarea id="relationships" spellcheck="false" rows="8" placeholder="doc:readme.owner@user:alice"></textarea>
    <label>Check</label>
    <input id="relationship" spellcheck="false" placeholder="doc:readme.view@user:alice" />
    <div class="row">
      <button id="check">Check</button>
      <button id="explain">Explain</button>
    </div>
  </section>
  <section class="result">
    <h2>Result</h2>
    <div id="badge" class="badge muted">—</div>
    <pre id="trace"></pre>
    <div id="error" class="error"></div>
  </section>
</main>
<script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private dispose(): void {
        PlaygroundPanel.current = undefined;
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
        this.panel.dispose();
    }
}
