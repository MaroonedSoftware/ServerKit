import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import {
    PlaygroundMethods,
    type CheckRequest,
    type DiscoverChecksResponse,
    type ExplainResponse,
    type LoadFixtureRequest,
    type LoadFixtureResponse,
    type PlaygroundMessage,
    type SaveFixtureRequest,
    type SaveFixtureResponse,
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

    /**
     * Reveal the singleton playground panel, creating it on first call.
     * Subsequent calls focus the existing panel and re-sync it from the
     * active `.perm` editor.
     */
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
            return;
        }
        if (msg.kind === 'requestLoadFixture') {
            await this.handleLoadFixture();
            return;
        }
        if (msg.kind === 'requestSaveFixture') {
            await this.handleSaveFixture(msg.relationships, msg.check);
            return;
        }
        if (msg.kind === 'requestDiscoverChecks') {
            const response = await this.client.sendRequest<DiscoverChecksResponse>(PlaygroundMethods.DiscoverChecks);
            await this.send({ kind: 'discoveredChecks', response });
            return;
        }
    }

    private async handleLoadFixture(): Promise<void> {
        const source = this.findPermDocument();
        const defaultDir = source ? vscode.Uri.file(path.dirname(source.fileName)) : undefined;
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            defaultUri: defaultDir,
            filters: { Fixture: ['yaml', 'yml'] },
            title: 'Open .perm.yaml fixture',
        });
        const target = picked?.[0];
        if (!target) return;
        const response = await this.client.sendRequest<LoadFixtureResponse>(PlaygroundMethods.LoadFixture, {
            path: target.fsPath,
        } satisfies LoadFixtureRequest);
        if (response.error) {
            await this.send({ kind: 'fixtureError', message: `Load failed: ${response.error}` });
            return;
        }
        await this.send({ kind: 'fixtureLoaded', relationships: response.relationships ?? '', check: response.check });
    }

    private async handleSaveFixture(relationships: string, check: string | undefined): Promise<void> {
        const source = this.findPermDocument();
        if (!source) {
            await this.send({ kind: 'fixtureError', message: 'open a .perm file before saving a fixture' });
            return;
        }
        const defaultPath = source.fileName.replace(/\.perm$/, '.perm.yaml');
        const picked = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultPath),
            filters: { Fixture: ['yaml', 'yml'] },
            title: 'Save .perm.yaml fixture',
        });
        if (!picked) return;
        const response = await this.client.sendRequest<SaveFixtureResponse>(PlaygroundMethods.SaveFixture, {
            path: picked.fsPath,
            schemaPath: source.fileName,
            relationships,
            check,
        } satisfies SaveFixtureRequest);
        if (response.error) {
            await this.send({ kind: 'fixtureError', message: `Save failed: ${response.error}` });
            return;
        }
        await this.send({ kind: 'fixtureSaved', path: picked.fsPath });
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
  <p class="hint">Pick a schema-aware tuple builder below — results update against the active <code>.perm</code> schema.</p>
  <div class="toolbar">
    <button id="seed" type="button" title="Generate one tuple per relation from the active schema">✨ Seed from schema</button>
    <button id="load-fixture" type="button" title="Load a .perm.yaml fixture">📂 Load fixture…</button>
    <button id="save-fixture" type="button" title="Save the current playground state as a .perm.yaml fixture">💾 Save fixture…</button>
    <button id="discover" type="button" title="Scan workspace .ts/.tsx files for check() call sites">🔍 Discover checks</button>
    <span id="toolbar-status" class="muted"></span>
  </div>
  <div id="discover-panel" class="discover-panel" hidden>
    <div class="discover-header">
      <strong>Discovered check() call sites</strong>
      <button id="discover-close" type="button" class="close" aria-label="Close">✕</button>
    </div>
    <ul id="discover-list" class="discover-list"></ul>
  </div>
</header>
<main>
  <section class="schema">
    <h2>Schema</h2>
    <div id="schema-summary" class="muted">no .perm file open</div>
  </section>

  <section class="input">
    <h2>Relationships</h2>
    <fieldset class="builder" id="rel-builder">
      <legend>Add relationship</legend>
      <div class="builder-row">
        <span class="object">
          <select id="rel-obj-ns" class="ns" aria-label="Object namespace"></select>
          <span class="sep">:</span>
          <input id="rel-obj-id" class="id" placeholder="id" aria-label="Object id" />
          <span class="sep">.</span>
          <select id="rel-rel" class="rel" aria-label="Relation"></select>
        </span>
        <span class="at">@</span>
        <span class="subject">
          <div class="kind-toggle" role="tablist" aria-label="Subject kind">
            <button type="button" data-kind="concrete" class="active">concrete</button>
            <button type="button" data-kind="wildcard">wildcard</button>
            <button type="button" data-kind="userset">userset</button>
          </div>
          <select id="rel-sub-ns" class="ns" aria-label="Subject namespace"></select>
          <span class="sep sub-id-sep">:</span>
          <input id="rel-sub-id" class="id" placeholder="id" aria-label="Subject id" />
          <span class="sep sub-rel-sep">.</span>
          <select id="rel-sub-rel" class="rel" aria-label="Subject relation"></select>
        </span>
        <button id="rel-add" type="button" class="add">+ Add</button>
      </div>
      <div id="rel-builder-error" class="error inline"></div>
    </fieldset>

    <label for="relationships">Tuples (one per line — edit freely)</label>
    <textarea id="relationships" spellcheck="false" rows="8" placeholder="doc:readme.owner@user:alice"></textarea>
    <div id="rel-validation" class="validation muted"></div>

    <h2>Check</h2>
    <fieldset class="builder" id="chk-builder">
      <legend>Compose a check</legend>
      <div class="builder-row">
        <span class="object">
          <select id="chk-obj-ns" class="ns" aria-label="Object namespace"></select>
          <span class="sep">:</span>
          <input id="chk-obj-id" class="id" placeholder="id" aria-label="Object id" />
          <span class="sep">.</span>
          <select id="chk-rel" class="rel" aria-label="Relation or permission"></select>
        </span>
        <span class="at">@</span>
        <span class="subject">
          <select id="chk-sub-ns" class="ns" aria-label="Subject namespace"></select>
          <span class="sep">:</span>
          <input id="chk-sub-id" class="id" placeholder="id" aria-label="Subject id" />
        </span>
      </div>
    </fieldset>

    <details class="raw">
      <summary>Advanced — raw tuple string</summary>
      <input id="relationship" spellcheck="false" placeholder="doc:readme.view@user:alice" />
    </details>

    <div class="row">
      <button id="check" type="button">Check</button>
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
