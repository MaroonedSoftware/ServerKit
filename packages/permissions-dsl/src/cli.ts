#!/usr/bin/env node
import { glob } from 'node:fs/promises';
import { formatTrace } from '@maroonedsoftware/permissions';
import { compile } from './compiler.js';
import { findConfig, loadConfig } from './config.js';
import { AggregateCompileError, CompileError, ParseError } from './diagnostics.js';
import { loadFixture } from './fixture.js';
import { explainRelationship, formatReport, runFixture } from './validate.js';

const usage = `pdsl — author, compile, and test .perm schemas

Usage:
  pdsl compile [--config <path>]            compile .perm files to TypeScript (default if no subcommand)
  pdsl validate <pattern...>                run assertions in one or more .perm.yaml fixtures
  pdsl check <fixture> <relationship>       check a single relationship against a fixture
  pdsl explain <fixture> <relationship>     same as 'check --explain'

Examples:
  pdsl validate 'tests/**/*.perm.yaml'
  pdsl check examples/doc.perm.yaml 'doc:readme.view@user:bob'
  pdsl explain examples/doc.perm.yaml 'doc:readme.view@user:bob'

Options:
  -c, --config <path>           path to permissions.config.json (for 'compile')
  --explain                     print a trace tree after 'check' (default for 'explain')
  -h, --help                    show this message
`;

interface CompileArgs {
    sub: 'compile';
    config?: string;
}
interface ValidateArgs {
    sub: 'validate';
    patterns: string[];
}
interface CheckArgs {
    sub: 'check' | 'explain';
    fixture: string;
    relationship: string;
    explain: boolean;
}

type Args = { help: true } | CompileArgs | ValidateArgs | CheckArgs;

const parseArgs = (argv: string[]): Args => {
    if (argv.length === 0) return { sub: 'compile' };

    // Treat any leading flag as belonging to `compile` (preserves backwards compat).
    const sub = argv[0];
    if (sub === '-h' || sub === '--help') return { help: true };

    if (sub === 'compile') {
        const rest = argv.slice(1);
        const args: CompileArgs = { sub: 'compile' };
        for (let i = 0; i < rest.length; i++) {
            const a = rest[i];
            if (a === '-c' || a === '--config') {
                const next = rest[++i];
                if (!next) throw new Error(`${a} requires a path`);
                args.config = next;
            } else if (a === '-h' || a === '--help') {
                return { help: true };
            } else {
                throw new Error(`compile: unknown argument: ${a}`);
            }
        }
        return args;
    }

    if (sub === 'validate') {
        const patterns = argv.slice(1).filter(a => a !== '-h' && a !== '--help');
        if (argv.slice(1).some(a => a === '-h' || a === '--help')) return { help: true };
        if (patterns.length === 0) throw new Error(`validate: at least one fixture path or glob is required`);
        return { sub: 'validate', patterns };
    }

    if (sub === 'check' || sub === 'explain') {
        const rest = argv.slice(1);
        let explainFlag = sub === 'explain';
        const positional: string[] = [];
        for (const a of rest) {
            if (a === '--explain') explainFlag = true;
            else if (a === '-h' || a === '--help') return { help: true };
            else positional.push(a);
        }
        if (positional.length !== 2) throw new Error(`${sub}: expected <fixture> <relationship>, got ${positional.length} positional arg(s)`);
        return { sub, fixture: positional[0]!, relationship: positional[1]!, explain: explainFlag };
    }

    // Legacy: `pdsl --config foo.json` (no subcommand) — treat as `compile`.
    if (sub === '-c' || sub === '--config') {
        const next = argv[1];
        if (!next) throw new Error(`${sub} requires a path`);
        return { sub: 'compile', config: next };
    }

    throw new Error(`unknown subcommand or argument: ${sub}`);
};

const runCompile = async (args: CompileArgs): Promise<number> => {
    const path = args.config ?? findConfig(process.cwd());
    if (!path) {
        process.stderr.write(`pdsl: no permissions.config.json found in ${process.cwd()} or any parent\n`);
        return 1;
    }
    const { config, configPath } = await loadConfig(path);
    const result = await compile(config);
    const wrote = result.outputs.length;
    const reused = result.cached.length;
    const summary = `pdsl: compiled ${result.namespaces.length} namespace(s) from ${result.inputs.length} file(s) — wrote ${wrote}, reused ${reused} from cache (config: ${configPath})\n`;
    process.stdout.write(summary);
    for (const out of result.outputs) {
        process.stdout.write(`  → ${out}\n`);
    }
    for (const removed of result.orphaned) {
        process.stdout.write(`  ✗ ${removed} (orphaned)\n`);
    }
    return 0;
};

const expandPatterns = async (patterns: string[]): Promise<string[]> => {
    const out = new Set<string>();
    for (const p of patterns) {
        // node:fs/promises glob (Node 22+) returns an AsyncIterable.
        for await (const file of glob(p)) out.add(file);
    }
    return [...out].sort();
};

const runValidate = async (args: ValidateArgs): Promise<number> => {
    const files = await expandPatterns(args.patterns);
    if (files.length === 0) {
        process.stderr.write(`pdsl validate: no files matched ${args.patterns.join(' ')}\n`);
        return 1;
    }
    let failed = 0;
    for (const file of files) {
        try {
            const fixture = await loadFixture(file);
            const report = await runFixture(fixture);
            process.stdout.write(`${formatReport(report)}\n`);
            failed += report.summary.failed;
        } catch (err) {
            failed++;
            if (err instanceof ParseError || err instanceof CompileError) {
                process.stderr.write(`${err.message}\n`);
            } else if (err instanceof Error) {
                process.stderr.write(`${file}: ${err.message}\n`);
            } else {
                process.stderr.write(`${file}: ${String(err)}\n`);
            }
        }
    }
    return failed === 0 ? 0 : 1;
};

const runCheckOrExplain = async (args: CheckArgs): Promise<number> => {
    const fixture = await loadFixture(args.fixture);
    if (args.explain) {
        const { allowed, trace } = await explainRelationship(fixture, args.relationship);
        process.stdout.write(`${allowed ? 'ALLOWED' : 'DENIED'}: ${args.relationship}\n`);
        process.stdout.write(`${formatTrace(trace)}\n`);
        return allowed ? 0 : 1;
    }
    const { allowed } = await explainRelationship(fixture, args.relationship);
    process.stdout.write(`${allowed ? 'ALLOWED' : 'DENIED'}: ${args.relationship}\n`);
    return allowed ? 0 : 1;
};

const main = async (): Promise<number> => {
    const args = parseArgs(process.argv.slice(2));
    if ('help' in args) {
        process.stdout.write(usage);
        return 0;
    }
    switch (args.sub) {
        case 'compile':
            return runCompile(args);
        case 'validate':
            return runValidate(args);
        case 'check':
        case 'explain':
            return runCheckOrExplain(args);
    }
};

main()
    .then(code => process.exit(code))
    .catch(err => {
        if (err instanceof AggregateCompileError) {
            for (const e of err.errors) process.stderr.write(`${e.message}\n\n`);
            process.stderr.write(`pdsl: ${err.errors.length} error(s)\n`);
        } else if (err instanceof ParseError || err instanceof CompileError) {
            process.stderr.write(`${err.message}\n`);
        } else if (err instanceof Error) {
            process.stderr.write(`pdsl: ${err.message}\n`);
        } else {
            process.stderr.write(`pdsl: ${String(err)}\n`);
        }
        process.exit(1);
    });
