import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWatch = process.argv.includes('--watch');
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const sharedBrowser = {
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: true,
    minify: false,
};

/** @type {import('esbuild').BuildOptions} */
const sharedNode = {
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'esm',
    sourcemap: true,
    minify: false,
    external: ['vscode'],
    // Bundled CJS deps (vscode-languageserver et al.) call `require("node:util")`.
    // esbuild's ESM shim throws "Dynamic require ... not supported"; this banner
    // installs a real `require` so node: built-ins resolve normally.
    banner: {
        js: "import { createRequire as __sk_createRequire } from 'node:module'; const require = __sk_createRequire(import.meta.url);",
    },
};

const clientConfig = {
    ...sharedNode,
    entryPoints: ['src/client/extension.ts'],
    outfile: 'dist/client/extension.js',
};

const serverConfig = {
    ...sharedNode,
    entryPoints: ['src/server/server.ts'],
    outfile: 'dist/server/server.js',
};

const webviewConfig = {
    ...sharedBrowser,
    entryPoints: ['src/client/playground/webview.ts'],
    outfile: 'dist/client/playground/webview.js',
};

function copyGrammar() {
    const src = resolve(__dirname, '../../packages/permissions-dsl/dist/permissions.ohm');
    const dest = resolve(__dirname, 'dist/server/permissions.ohm');
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
}

function copyWebviewAssets() {
    const src = resolve(__dirname, 'src/client/playground/webview.css');
    const dest = resolve(__dirname, 'dist/client/playground/webview.css');
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
}

if (isWatch) {
    const [clientCtx, serverCtx, webviewCtx] = await Promise.all([
        esbuild.context(clientConfig),
        esbuild.context(serverConfig),
        esbuild.context(webviewConfig),
    ]);
    await Promise.all([clientCtx.watch(), serverCtx.watch(), webviewCtx.watch()]);
    copyGrammar();
    copyWebviewAssets();
    console.log('Watching for changes...');
} else {
    await Promise.all([
        esbuild.build(clientConfig),
        esbuild.build(serverConfig),
        esbuild.build(webviewConfig),
    ]);
    copyGrammar();
    copyWebviewAssets();
    console.log('Build complete.');
}
