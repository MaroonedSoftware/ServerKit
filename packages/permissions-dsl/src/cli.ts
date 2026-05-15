#!/usr/bin/env node
import { compile } from './compiler.js';
import { findConfig, loadConfig } from './config.js';
import { CompileError } from './diagnostics.js';

interface Args {
    config?: string;
    help: boolean;
}

const parseArgs = (argv: string[]): Args => {
    const args: Args = { help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') args.help = true;
        else if (a === '--config' || a === '-c') {
            const next = argv[++i];
            if (!next) throw new Error(`--config requires a path`);
            args.config = next;
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    return args;
};

const usage = `pdsl — compile .perm files into TypeScript

Usage:
  pdsl                           discover permissions.config.json walking up from cwd
  pdsl --config <path>           use the specified config file

Options:
  -c, --config <path>            path to permissions.config.json
  -h, --help                     show this message
`;

const main = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(usage);
        return;
    }
    const path = args.config ?? findConfig(process.cwd());
    if (!path) {
        process.stderr.write(`pdsl: no permissions.config.json found in ${process.cwd()} or any parent\n`);
        process.exit(1);
    }
    const { config, configPath } = await loadConfig(path);
    const result = await compile(config);
    process.stdout.write(`pdsl: compiled ${result.namespaces.length} namespace(s) from ${result.inputs.length} file(s) (config: ${configPath})\n`);
    for (const out of result.outputs) {
        process.stdout.write(`  → ${out}\n`);
    }
};

main().catch(err => {
    if (err instanceof CompileError) {
        process.stderr.write(`${err.message}\n`);
    } else if (err instanceof Error) {
        process.stderr.write(`pdsl: ${err.message}\n`);
    } else {
        process.stderr.write(`pdsl: ${String(err)}\n`);
    }
    process.exit(1);
});
