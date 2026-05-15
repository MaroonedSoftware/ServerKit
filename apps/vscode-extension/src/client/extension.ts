import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node.js';
import { PlaygroundPanel } from './playground.panel.js';

let client: LanguageClient | undefined;

class PlaygroundCodeLensProvider implements vscode.CodeLensProvider {
    onDidChangeCodeLenses?: vscode.Event<void>;

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');
        // Cheap line-based scan — no need to round-trip through the LSP server
        // for a lens "Open in Playground" above each namespace declaration.
        const re = /^\s*(namespace|permission)\s+([a-z][a-z0-9_]*)/;
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i] ?? '')) {
                const range = new vscode.Range(i, 0, i, (lines[i] ?? '').length);
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: '$(play) Open in Playground',
                        command: 'serverkit.permissions.openPlayground',
                    }),
                );
            }
        }
        return lenses;
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6010'] },
        },
    };

    const permWatcher = vscode.workspace.createFileSystemWatcher('**/*.perm');
    context.subscriptions.push(permWatcher);

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'serverkit-permissions' }],
        synchronize: { fileEvents: permWatcher },
    };

    client = new LanguageClient('serverkitPermissions', 'ServerKit Permissions Language Server', serverOptions, clientOptions);
    await client.start();

    context.subscriptions.push(
        vscode.commands.registerCommand('serverkit.permissions.openPlayground', () => {
            if (!client) return;
            PlaygroundPanel.show(context, client);
        }),
        vscode.languages.registerCodeLensProvider({ language: 'serverkit-permissions' }, new PlaygroundCodeLensProvider()),
    );
}

export async function deactivate(): Promise<void> {
    if (!client) return;
    await client.stop();
    client = undefined;
}
