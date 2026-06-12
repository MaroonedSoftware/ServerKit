# @maroonedsoftware/johnny5

A small CLI framework for ServerKit applications. Build a typed [commander](https://github.com/tj/commander.js) program from declarative `CommandModule` objects, plug in a `doctor` health-check runner, discover commands contributed by workspace packages, and (optionally) hand commands a fully-bootstrapped InjectKit container.

## Why

Most internal CLIs grow the same way: a `commander` skeleton, a sprawling `doctor` script, ad-hoc DI wiring so commands can reuse application services, and a copy of the same Postgres/Redis/Docker liveness checks across every repo. Johnny5 packages those into one composable surface so each repo only writes the commands that are actually unique to it.

## Install

```bash
pnpm add @maroonedsoftware/johnny5
# Optional peers — install only what your checks/commands need:
pnpm add pg ioredis kysely @maroonedsoftware/koa
```

`pg`, `ioredis`, `kysely`, and `@maroonedsoftware/koa` are declared as optional peers. The Postgres / Redis / ServerKit integrations are lazy-loaded, so packages you don't install are never required at runtime.

## Quickstart

```ts
#!/usr/bin/env node
import { createCliApp, defineCommand } from '@maroonedsoftware/johnny5';
import { nodeVersion } from '@maroonedsoftware/johnny5/versions';
import { postgresReachable } from '@maroonedsoftware/johnny5/postgres';

const hello = defineCommand({
    description: 'say hello',
    options: [{ flags: '--name <name>', description: 'who to greet' }],
    run: async (opts, ctx) => {
        ctx.logger.success(`hi, ${opts['name'] ?? 'world'}`);
    },
});

const app = await createCliApp({
    name: 'my-cli',
    description: 'example CLI',
    version: '0.0.1',
    commands: [{ path: ['hello'], module: hello }],
    checks: [nodeVersion({ min: 22 }), postgresReachable()],
});

process.exit(await app.run(process.argv));
```

- `my-cli hello --name alice` invokes the command.
- `my-cli doctor` is auto-registered because `checks` is non-empty; `my-cli doctor --fix` runs `autoFix` hooks where available.
- `-v` / `--verbose` is wired up globally and flips `logger.debug` on.

## TypeScript bin shim

To ship a `bin` that runs your TypeScript entry point directly (no build step), point `package.json`'s `bin` at a plain `.js` shim and let johnny5 wire up the [`@swc-node/register`](https://github.com/swc-project/swc-node) ESM loader:

```js
#!/usr/bin/env node
// bin/my-cli.js
import { runTypescriptBin } from '@maroonedsoftware/johnny5/bin';
await runTypescriptBin(import.meta.url); // registers swc, then imports ../src/index.ts
```

`runTypescriptBin(import.meta.url, { tsconfig?, entry? })` defaults to `../tsconfig.json` and `../src/index.ts` relative to the bin file. Compared to `node --import @swc-node/register/esm-register`, the shim fixes three sharp edges:

- The stock `esm-register` shim resolves the loader hook from `process.cwd()`, which breaks when the bin is invoked from outside its own package (e.g. a workspace-root launcher or a globally linked bin). johnny5 anchors the hook to the bin file instead.
- swc-node discovers its tsconfig from cwd; the shim sets `SWC_NODE_PROJECT` to the package tsconfig (unless you've already set it).
- Node 26 deprecates `module.register()` (DEP0205); the shim suppresses that warning narrowly, just around the register call, without disabling deprecation warnings globally.

`registerTypescriptLoader(import.meta.url, { tsconfig? })` is also exported if you want the loader without the entry-point import. `@swc-node/register` is resolved from the package that owns the bin file, so install it there (it's declared as an optional peer).

## Defining commands

`defineCommand` is an identity helper that lets TypeScript infer the option object from the literal:

```ts
const greet = defineCommand({
    description: 'greet a person',
    args: [{ name: 'who', description: 'name', required: true }],
    options: [
        { flags: '--loud', description: 'shout', type: 'boolean' },
        { flags: '--times <n>', description: 'repeat', type: 'number', default: 1, envVar: 'GREET_TIMES' },
    ],
    run: async (opts, ctx, args) => {
        const [who] = args;
        const message = opts.loud ? `HI, ${who?.toUpperCase()}!` : `hi, ${who}`;
        for (let i = 0; i < Number(opts.times ?? 1); i++) ctx.logger.info(message);
    },
});
```

Key behaviours:

- **`path`** registers the command in the CLI tree. `['db', 'migrate']` becomes `my-cli db migrate`; intermediate groups are created on demand.
- **`envVar`** falls back to `process.env` when a flag isn't supplied on the command line.
- **`interactive`** runs after parsing only when stdin/stdout are TTYs — use it to prompt for missing options with `prompts` / `unwrap`.
- **`passthrough: true`** forwards unknown options and extra positional args verbatim, useful for proxying through to a wrapped binary.
- **Return value** — return a non-zero number from `run` to `process.exit(code)`. Throwing logs the error and exits 1.

## Safety guards

Two declarative fields on `CommandModule` let you fence in commands that shouldn't run unchecked:

```ts
const drop = defineCommand({
    description: 'drop the database',
    dangerous: true,                                // prompts Y/N in a TTY; refuses without --yes in CI
    allowedEnvironments: ['development', 'staging'], // refuses unless NODE_ENV matches
    run: async (_opts, ctx) => {
        ctx.logger.success('dropped');
    },
});
```

- **`dangerous: true`** auto-registers a `-y, --yes` flag (skipped if you already declared one) and runs a confirmation prompt before `run`. In non-TTY contexts `--yes` is required; without it the command exits 1.
- **`dangerous: { confirm: 'typed', phrase: 'DROP PRODUCTION' }`** requires the user to retype an exact phrase. `phrase` defaults to the full command path (e.g. `db drop`). A custom `message` overrides the prompt text.
- **`allowedEnvironments: ['development']`** reads `NODE_ENV` from `ctx.env`. Pass the spec form `{ allowed: ['dev'], variable: 'APP_ENV' }` to read a different variable. The guard runs before any dangerous prompt, so a misconfigured environment fails fast.

## CliContext

Every command, check, and plugin hook receives the same `CliContext`:

| Field | Description |
| --- | --- |
| `paths.cwd` | `process.cwd()` at startup. |
| `paths.repoRoot` | Nearest ancestor containing `pnpm-workspace.yaml`, else `cwd`. |
| `logger` | ANSI-coloured console logger (`info`/`warn`/`error`/`debug`/`success`). Override via `createCliApp({ logger })`. |
| `shell` | `execa` wrapper bound to `repoRoot`; `run` returns the result promise, `runStreaming` inherits stdio and returns the exit code, `runDetached` spawns a detached background process. |
| `daemons` | Project-scoped manager for long-running detached processes. See [Background daemons](#background-daemons). |
| `config` | An `AppConfig` instance. Defaults to one with only the dotenv provider attached; pass `config` to `createCliApp` for the full builder. |
| `env` | `process.env`. |
| `isInteractive()` | True when both stdin and stdout are TTYs. |

`buildContext` automatically loads `.env` and `apps/api/.env` from the workspace root into `process.env` before building `AppConfig`. Override the list via `BuildContextOptions.envFiles` if you call `buildContext` directly. Existing env vars are never overwritten; `$VAR` and `${VAR}` references inside unquoted/double-quoted values are expanded.

## The doctor runner

A `Check` is a named async function that returns `{ ok, message, fixHint?, autoFix? }`. The runner renders progress as it goes:

```
Running doctor…

  node ≥ 22                            ✓ Node v22.11.0
  postgres reachable                   ✗ DATABASE_URL is not set
    → Set DATABASE_URL in your .env.
  docker compose services up           ✗ not running: postgres, redis
    ↻ attempting auto-fix… ✓ compose services started
```

`my-cli doctor --fix` invokes `autoFix` on any failing check that provides one. The exit code is `0` when every check ends green and `1` otherwise.

### Built-in check libraries

Each integration is a subpath export so you only import the drivers you actually use.

```ts
import { nodeVersion, pnpmVersion } from '@maroonedsoftware/johnny5/versions';
import { envFile, portsFree } from '@maroonedsoftware/johnny5/filesystem';
import { postgresReachable } from '@maroonedsoftware/johnny5/postgres';
import { redisReachable } from '@maroonedsoftware/johnny5/redis';
import { dockerServicesUp } from '@maroonedsoftware/johnny5/docker';
import { kyselyTableExists } from '@maroonedsoftware/johnny5/kysely';
import { permissionsSchemaCompiled, permissionsFixturesPass, permissionsModelLoads } from '@maroonedsoftware/johnny5/permissions';

const checks = [
    nodeVersion({ min: 22 }),
    pnpmVersion({ expected: '10.24.0' }),
    envFile({ path: '.env', required: ['DATABASE_URL', 'REDIS_HOST'] }),
    portsFree({ ports: [{ port: 3000, label: 'api' }, 5432, 6379] }),
    postgresReachable(),                       // reads DATABASE_URL from AppConfig, falling back to process.env
    redisReachable(),                          // REDIS_HOST/REDIS_PORT from AppConfig / env, defaulting to localhost:6379
    dockerServicesUp({ autoStart: true }),     // adds an autoFix that runs `docker compose up -d`
    kyselyTableExists({ db, table: 'relation_tuples' }),    // verify a migration-managed table
    permissionsSchemaCompiled(),                             // .perm files in sync with generated TS
    permissionsFixturesPass({ patterns: ['permissions/**/*.perm.yaml'] }),
    permissionsModelLoads({ loadModel: async () => (await import('./permissions/generated/index.js')).model }),
];
```

The `kysely` and `permissions` subpaths lazy-load their peer deps (`kysely`, `@maroonedsoftware/permissions`, `@maroonedsoftware/permissions-dsl`), so the bundle cost is paid only by the checks you actually wire up.

- **`permissionsSchemaCompiled({ configPath? })`** runs `compile()` in dry-run mode and fails if any generated TypeScript would be rewritten or removed. `doctor --fix` performs the real compile.
- **`permissionsFixturesPass({ patterns })`** evaluates every matched `.perm.yaml` fixture. See `pdsl validate` for the full TAP-style report.
- **`permissionsModelLoads({ loadModel })`** surfaces duplicate-namespace / unresolved-reference errors from the `AuthorizationModel` constructor at doctor time instead of on the first runtime Check.
- **`kyselyTableExists({ db, table, schema? })`** asks Kysely's introspection API whether a table exists. Pair with the permissions tuples table, the jobs table, or any other migration-managed schema.

Custom checks are just `Check` objects — there's no registration step:

```ts
const migrationsApplied: Check = {
    name: 'db migrations',
    run: async ctx => {
        const result = await ctx.shell.run('dbmate', ['status']);
        return String(result.stdout).includes('Pending: 0')
            ? { ok: true, message: 'up to date' }
            : { ok: false, message: 'pending migrations', fixHint: 'Run `pnpm db:migrate`.' };
    },
    autoFix: async ctx => {
        const exit = await ctx.shell.runStreaming('dbmate', ['up']);
        return exit === 0 ? { ok: true, message: 'migrated' } : { ok: false, message: `dbmate exited ${exit}` };
    },
};
```

Pass `doctorCommandPath: ['health']` to change the subcommand name, or `null` to suppress auto-registration when you want to ship your own.

## ServerKit integration

Wire a list of `ServerKitModule`s into the CLI and any command can resolve services from a scoped InjectKit container — without you writing the bootstrap glue.

```ts
import { createCliApp, defineCommand } from '@maroonedsoftware/johnny5';
import { requireContainer } from '@maroonedsoftware/johnny5/serverkit';
import { UserService } from './services/user.service.js';
import { databaseModule, jobsModule } from './modules.js';

const listUsers = defineCommand({
    description: 'list active users',
    run: requireContainer(async (_opts, ctx) => {
        const users = await ctx.container.resolve(UserService).listActive();
        for (const u of users) ctx.logger.info(`${u.id}\t${u.email}`);
    }),
});

const app = await createCliApp({
    name: 'my-cli',
    description: 'example CLI',
    version: '0.0.1',
    config: () => loadAppConfig(),
    modules: [databaseModule, jobsModule],
    commands: [{ path: ['users', 'list'], module: listUsers }],
});
```

Behaviour worth knowing:

- The container is bootstrapped **lazily** on the first `requireContainer` call. Commands that never touch DI don't pay for it.
- Each invocation of a wrapped handler gets a **fresh scoped container** via `container.createScopedContainer()`.
- `module.setup(registry, config)` runs; `module.start(container)` does **not** — CLIs don't want HTTP listeners or job pollers spinning up.
- The root container survives between handler calls in the same process (handy for composite commands). `module.shutdown` hooks only fire if you call `bootstrapForCli` yourself.

For finer control, call `bootstrapForCli({ modules, config })` directly and manage the container/shutdown lifecycle yourself.

## Background daemons

Commands often need to start a long-running dev process (Storybook, a watch-mode bundler, a vendor daemon) and let the user's terminal go free. `ctx.daemons` is built for that:

```ts
const start = defineCommand({
    description: 'start storybook in the background',
    run: async (_opts, ctx) => {
        const status = ctx.daemons.start({
            name: 'storybook',
            command: 'pnpm',
            args: ['--filter', '@acme/ui', 'exec', 'storybook', 'dev', '-p', '6006', '--no-open'],
        });
        ctx.logger.success(`storybook running (pid ${status.pid}) — log: ${status.logFile}`);
    },
});

const stop = defineCommand({
    description: 'stop storybook',
    run: async (_opts, ctx) => {
        ctx.daemons.stop('storybook') ? ctx.logger.success('stopped') : ctx.logger.warn('not running');
    },
});
```

What you get:

- **Idempotent `start`** — when a daemon is already running, the default `onExisting: 'reuse'` policy returns the existing handle and skips the spawn. Use `'restart'` to terminate-and-respawn, or `'error'` to throw.
- **`stop`, `status`, `list`** — `stop` sends `SIGTERM` (override via `{ signal }`) and deletes the pid file. `status(name)` returns the recorded `{ pid, running, logFile, pidFile, command, args, cwd, startedAt }` (or `undefined`). `list()` returns the status of every daemon registered for the current project.
- **Project-scoped state** — pid and log files are placed under `<johnnyPaths.runtime>/<projectSlug>/` and `<johnnyPaths.log>/<projectSlug>/`. The slug is `<basename>-<sha256(repoRoot).slice(0,8)>`, so two checkouts of the same repo at different paths get distinct daemon namespaces while remaining easy to identify in `ls` output.
- **OS-native locations** — `johnnyPaths('johnny5')` returns the conventional dirs for each platform: macOS `~/Library/Logs/johnny5` + `$TMPDIR/johnny5`; Linux `$XDG_STATE_HOME/johnny5` + `$XDG_RUNTIME_DIR/johnny5`; Windows `%LOCALAPPDATA%\johnny5\{Log,Temp}`. Logs are append-only and rotate-friendly; pid files live in runtime/temp dirs that the OS may clear on reboot — exactly the right behaviour for stale records.

Under the hood, daemons are spawned via `Shell.runDetached(command, args, { logFile, cwd?, env? })`. Drop down to it directly when you want detached spawn without the pid-file bookkeeping:

```ts
const { pid, logFile } = ctx.shell.runDetached('node', ['worker.js'], { logFile: '/tmp/worker.log' });
```

## Plugin discovery

Workspace packages can contribute commands without the CLI entrypoint knowing about them. In a plugin package's `package.json`:

```json
{
    "name": "@acme/billing",
    "johnny5": { "commands": "./dist/cli/commands.js" }
}
```

The referenced file must default-export a `PluginManifest`:

```ts
// apps/billing/src/cli/commands.ts
import type { PluginManifest } from '@maroonedsoftware/johnny5';
import { reconcile } from './commands/reconcile.js';

const manifest: PluginManifest = {
    name: '@acme/billing',
    commands: [{ path: ['billing', 'reconcile'], module: reconcile }],
};

export default manifest;
```

Enable discovery in the host CLI:

```ts
await createCliApp({
    /* … */
    plugins: {
        workspace: {
            roots: ['apps', 'packages'],          // dirs to scan; default shown
            excludePackages: ['@acme/cli'],       // skip the host CLI's own package
        },
    },
});
```

Core commands are registered before plugin commands. If a plugin tries to claim a path already owned by core (or by another plugin loaded earlier), `createCliApp` throws with a descriptive error — there's no silent override. Plugins that fail to load are logged through `ctx.logger.warn` and skipped.

## Interactive prompts

`@clack/prompts` is re-exported under `prompts`, plus an `unwrap` helper that converts cancellations into a thrown `PromptCancelledError` so command handlers can rely on plain try/catch:

```ts
import { prompts, unwrap } from '@maroonedsoftware/johnny5';

const create = defineCommand({
    description: 'create a user',
    options: [{ flags: '--email <email>', description: 'email address' }],
    interactive: async (_ctx, partial) => ({
        email: partial.email ?? unwrap(await prompts.text({ message: 'Email?' })),
    }),
    run: async (opts, ctx) => {
        ctx.logger.success(`Creating ${opts.email}…`);
    },
});
```

`interactive` only runs when both stdin and stdout are TTYs, so the same command works unchanged in CI.

## Wizard flows

Multi-step interactive flows pile up `clack.isCancel` / `clack.outro('aborted')` boilerplate at every prompt. `wizard` collapses that into a single try/catch: prompt methods on the session throw `PromptCancelledError` on cancellation, and the wrapper catches it, prints a uniform outro, and returns an exit code.

```ts
import { wizard } from '@maroonedsoftware/johnny5';

const setup = defineCommand({
    description: 'first-run wizard',
    run: async (_opts, ctx) =>
        wizard(ctx, { title: 'my-cli — local dev bootstrap' }, async w => {
            if (await w.confirm({ message: 'Start docker compose services?', initialValue: true })) {
                const exit = await ctx.shell.runStreaming('docker', ['compose', 'up', '-d'], { cwd: ctx.paths.repoRoot });
                if (exit !== 0) {
                    w.log.error(`docker compose up exited ${exit}`);
                    return exit;
                }
            }
            const email = await w.text({ message: 'Test user email' });
            const password = await w.password({ message: 'Test user password' });
            await ctx.shell.runStreaming('pnpm', ['seed', `--email=${email}`, `--password=${password}`]);
        }),
});
```

- The body is linear — no `isCancel` checks anywhere. Cancelling any prompt aborts the whole flow with the configured outro and exit code (defaults: `'aborted'` and `1`).
- Return a number from the body to override the success exit code; return `void` for `0`.
- `w.cancel()` aborts from inside the body the same as a user cancel. Non-cancel errors propagate unchanged.
- `w.outro('all set — run pnpm doctor')` lets the body customize the success outro dynamically. Static overrides go on `WizardOptions` (`successOutro` / `cancelOutro` / `cancelExitCode`).
- `w.log` and `w.spinner` are pass-throughs to the matching `clack` helpers, so existing logging stays consistent inside the wizard.

`wizard` only assumes interactivity to the extent that `clack` does. Gate the call with `if (!ctx.isInteractive()) return 1` (or surface a clearer error) when running non-interactively makes no sense for the command.

## Optional: system keyring

`@maroonedsoftware/johnny5/keyring` wraps the OS keyring (Keychain on macOS, Credential Manager on Windows, libsecret on Linux) via [@napi-rs/keyring](https://github.com/napi-rs/node-keyring). The native module is an **optional peer dependency** — install it only in CLIs that need credential storage:

```bash
pnpm add @napi-rs/keyring
```

`keyringEntry` builds a single safe slot. Every operation returns `null` / `false` instead of throwing — failures (missing peer dep, locked keychain, OS denial) are surfaced through `ctx.logger.warn` exactly once.

```ts
import { keyringEntry, resolveSecret } from '@maroonedsoftware/johnny5/keyring';

const apiKeyEntry = keyringEntry(ctx, { service: 'my-cli', account: 'anthropic.api.key' });

await apiKeyEntry.write('sk-…');             // true on success, false otherwise
const stored = await apiKeyEntry.read();     // string | null
await apiKeyEntry.delete();                  // true if a value was removed
```

`resolveSecret` codifies the override → env → keyring → prompt chain that most CLIs end up writing by hand:

```ts
const apiKey = await resolveSecret(ctx, {
    override: opts.apiKey,                                    // wins over everything; never persisted
    envKeys: ['ANTHROPIC_API_KEY'],                           // first non-empty wins
    keyring: apiKeyEntry,
    prompt: async () => unwrap(await prompts.password({ message: 'Paste your API key' })),
    promptStore: 'ask',                                       // 'ask' (default) | 'always' | 'never'
    label: 'API key',
});

if (!apiKey) {
    ctx.logger.error('No credentials found. Set ANTHROPIC_API_KEY or run `my-cli login`.');
    return 1;
}
```

- The resolution chain is fixed: `override` first, then `envKeys` in order (both `ctx.env` and `process.env` are checked), then `keyring.read()`, then `prompt(ctx)`.
- A freshly-prompted value is written back to `keyring` according to `promptStore`. `'ask'` runs a `clack.confirm` (defaulting to yes); `'always'` and `'never'` skip the question. The `label` shows up in the confirm message.
- `resolveSecret` returns `null` when every source yields nothing and never calls `process.exit` — callers decide whether missing credentials are a hard error.

## Exports

| Path | Provides |
| --- | --- |
| `@maroonedsoftware/johnny5` | `createCliApp`, `defineCommand`, `registerCommands`, `runChecks`, `buildContext`, `buildDefaultAppConfig`, `loadWorkspacePlugins`, `createShell`, `createDaemons`, `johnnyPaths`, `projectSlug`, `createDefaultLogger`, `prompts`, `unwrap`, `wizard`, `isInteractive`, plus the `Check` / `CommandModule` / `CliContext` / `Daemons` / `WizardSession` types. |
| `/bin` | `runTypescriptBin`, `registerTypescriptLoader` — TypeScript bin shim (resolves `@swc-node/register` from the consumer). |
| `/serverkit` | `bootstrapForCli`, `configureServerKitModules`, `getOrBootstrapContainer`, `requireContainer`. |
| `/versions` | `nodeVersion`, `pnpmVersion`. |
| `/filesystem` | `envFile`, `portsFree`. |
| `/postgres` | `postgresReachable` (lazy-loads `pg`). |
| `/redis` | `redisReachable` (lazy-loads `ioredis`). |
| `/docker` | `dockerServicesUp`. |
| `/kysely` | `kyselyTableExists` (lazy-loads `kysely`). |
| `/permissions` | `permissionsSchemaCompiled`, `permissionsFixturesPass`, `permissionsModelLoads` (lazy-load `@maroonedsoftware/permissions[-dsl]`). |
| `/keyring` | `keyringEntry`, `resolveSecret` (lazy-load `@napi-rs/keyring`). |

## License

MIT
