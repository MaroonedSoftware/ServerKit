# AGENTS.md — @maroonedsoftware/johnny5

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A CLI framework for ServerKit applications. `createCliApp` assembles a `commander` program from
declarative `CommandModule` definitions, adds a `doctor` command with auto-remediation, discovers
commands from workspace packages via a `"johnny5"` field in their `package.json`, and hands every
command a `CliContext` (paths, logger, shell, daemons, config). Nine opt-in subpaths supply doctor
checks and integrations for ServerKit DI, Postgres, Redis, Docker, filesystem, versions, Kysely,
permissions, and an OS keyring.

Reach for it when a ServerKit app needs an operator CLI. Do **not** reach for it for a general
argument parser — that is `commander`, which this wraps.

## Install

```bash
pnpm add @maroonedsoftware/johnny5
```

Runtime dependencies: `@clack/prompts`, `@maroonedsoftware/appconfig`, `@maroonedsoftware/logger`,
`commander`, `execa`, `injectkit`, `luxon`. **Eight optional peers**, one per integration subpath:
`@maroonedsoftware/koa`, `@maroonedsoftware/permissions`, `@maroonedsoftware/permissions-dsl`,
`@napi-rs/keyring`, `@swc-node/register`, `ioredis`, `kysely`, `pg`.

## Position in the graph

- **Depends on:** `appconfig`, `logger`. `koa`, `permissions`, and `permissions-dsl` are **optional**
  peers reached only through their subpaths.
- **Depended on by:** nothing internal.
- **Subpath exports:** ten, and every one exists to keep an optional peer off the core install.

| Subpath         | Exports                                                                                                                                                        | Optional peer pulled in                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.`             | The framework: `createCliApp`, `defineCommand`, types, utilities                                                                                               | none                                                                 |
| `./bin`         | `registerTypescriptLoader`, `runTypescriptBin` (+ their options types)                                                                                         | `@swc-node/register`                                                 |
| `./serverkit`   | `bootstrapForCli`, `configureServerKitModules`, `getOrBootstrapContainer`, `requireContainer`, `CliContainer`, `BootstrapForCliOptions`, `RequireContainerCtx` | `@maroonedsoftware/koa`                                              |
| `./postgres`    | `postgresReachable`, `PostgresReachableOptions`                                                                                                                | `pg`                                                                 |
| `./redis`       | `redisReachable`, `RedisReachableOptions`                                                                                                                      | `ioredis`                                                            |
| `./docker`      | `dockerServicesUp`, `DockerServicesOptions`                                                                                                                    | none (shells out)                                                    |
| `./versions`    | `nodeVersion`, `pnpmVersion` (+ options)                                                                                                                       | none                                                                 |
| `./filesystem`  | `envFile`, `portsFree` (+ options)                                                                                                                             | none                                                                 |
| `./kysely`      | `kyselyTableExists`, `KyselyTableExistsOptions`                                                                                                                | `kysely`                                                             |
| `./permissions` | `permissionsSchemaCompiled`, `permissionsFixturesPass`, `permissionsModelLoads` (+ options)                                                                    | `@maroonedsoftware/permissions`, `@maroonedsoftware/permissions-dsl` |
| `./keyring`     | `keyringEntry`, `KeyringEntry`, `resolveSecret`, `PromptStorePolicy`, `ResolveSecretOptions`                                                                   | `@napi-rs/keyring`                                                   |

Everything under `./postgres` through `./permissions` returns a `Check` for the doctor runner.

## API surface

### `.` — the framework

| Export                                                           | Kind                 | Shape                                                                                                         | Notes                                                                     |
| ---------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `createCliApp`                                                   | function             | `<ConfigT>(options: CliAppOptions<ConfigT>) => Promise<CliApp>`                                               | Async. Auto-registers `doctor` when `checks` is non-empty.                |
| `CliApp`                                                         | interface            | `{ run(argv?: string[]): Promise<number> }`                                                                   | Resolves with an exit code — it does **not** call `process.exit`.         |
| `CliAppOptions<ConfigT>`                                         | interface            | `{ name, description, version, commands, checks?, config?, logger?, modules?, plugins?, doctorCommandPath? }` | `config` may be a value or an async factory.                              |
| `defineCommand`                                                  | function             | `<Opts>(mod: CommandModule<Opts>) => CommandModule<Opts>`                                                     | Identity helper — exists purely so `Opts` is inferred from the literal.   |
| `CommandModule<Opts>`                                            | interface            | `{ description, name?, options?, args?, interactive?, run, passthrough?, dangerous?, allowedEnvironments? }`  | `run` returning a non-zero number triggers `process.exit(code)`.          |
| `CommandRegistration`                                            | interface            | `{ path: string[]; module: CommandModule }`                                                                   | `path` is the CLI subcommand tree position.                               |
| `DiscoveredCommand`                                              | interface            | `extends CommandRegistration` with `source: 'core' \| 'plugin'`, `sourceName?`                                | Used for collision reporting.                                             |
| `OptionSpec`                                                     | interface            | `{ flags, description, type?, default?, required?, envVar? }`                                                 | `envVar` supplies the value when the flag is absent.                      |
| `ArgSpec`                                                        | interface            | `{ name, description, required?, variadic? }`                                                                 | —                                                                         |
| `OptionType`                                                     | type                 | `'string' \| 'number' \| 'boolean'`                                                                           | —                                                                         |
| `DangerousSpec`                                                  | interface            | `{ confirm?: 'yes' \| 'typed'; phrase?; message? }`                                                           | `'typed'` requires retyping `phrase` (defaults to the full command path). |
| `EnvironmentGuardSpec`                                           | interface            | `{ allowed: string[]; variable? }`                                                                            | `variable` defaults to `NODE_ENV`.                                        |
| `CliContext`                                                     | interface            | `{ paths, logger, shell, daemons, config, isInteractive(), env }`                                             | Handed to every command, check, and plugin hook.                          |
| `CliPaths`                                                       | interface            | `{ cwd, repoRoot }`                                                                                           | `repoRoot` is the **consumer's** workspace.                               |
| `buildContext` / `buildDefaultAppConfig` / `BuildContextOptions` | function / interface | —                                                                                                             | For building a context outside `createCliApp`.                            |
| `registerCommands`                                               | function             | Registers a command tree onto a `commander` program                                                           | —                                                                         |

### `.` — doctor

| Export               | Kind      | Shape                                                                           | Notes                                                     |
| -------------------- | --------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Check`              | interface | `{ name, run(ctx): Promise<CheckResult>, autoFix?(ctx): Promise<CheckResult> }` | `autoFix` runs for failing checks when `--fix` is passed. |
| `CheckResult`        | interface | `{ ok, message, fixHint? }`                                                     | `fixHint` renders when `--fix` is **not** in play.        |
| `runChecks`          | function  | `(checks, ctx, options?) => …`                                                  | —                                                         |
| `buildDoctorCommand` | function  | `(options: DoctorOptions) => CommandModule`                                     | For supplying your own doctor command path.               |
| `DoctorOptions`      | interface | —                                                                               | —                                                         |

### `.` — plugins and utilities

| Export                                                                             | Kind                 | Notes                                                                   |
| ---------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `loadWorkspacePlugins` / `WorkspacePluginOptions`                                  | function / interface | Scans `roots` (default `['apps', 'packages']`) for a `"johnny5"` field. |
| `PluginManifest`                                                                   | interface            | `{ name, commands }` — what a plugin's commands file default-exports.   |
| `createDefaultLogger` / `CliLogger` / `CreateLoggerOptions`                        | function / types     | —                                                                       |
| `createShell` / `Shell` / `ShellOptions` / `DetachedHandle` / `RunDetachedOptions` | function / types     | Over `execa`.                                                           |
| `createDaemons` / `Daemons` / `DaemonStartOptions` / `DaemonStatus`                | function / types     | Project-scoped long-running detached processes.                         |
| `johnnyPaths` / `projectSlug` / `JohnnyPaths`                                      | function / type      | Filesystem anchors.                                                     |
| `isInteractive`                                                                    | function             | TTY check.                                                              |
| `prompts` / `unwrap` / `PromptCancelledError`                                      | —                    | Over `@clack/prompts`. `unwrap` turns a cancel into a throw.            |
| `wizard` / `WizardOptions` / `WizardSession`                                       | function / types     | Multi-step interactive flows.                                           |

## Canonical usage

```typescript
import { createCliApp, defineCommand } from '@maroonedsoftware/johnny5';
import { postgresReachable } from '@maroonedsoftware/johnny5/postgres';
import { nodeVersion, pnpmVersion } from '@maroonedsoftware/johnny5/versions';
import { requireContainer } from '@maroonedsoftware/johnny5/serverkit';

const seed = defineCommand({
  description: 'Seed the development database',
  options: [{ flags: '--count <n>', description: 'Rows to create', type: 'number', default: 10 }],
  dangerous: { confirm: 'typed', phrase: 'seed' },
  allowedEnvironments: ['development', 'test'],
  async run(opts, ctx) {
    const container = await requireContainer(ctx);
    await container.get(SeedService).run(opts.count);
  },
});

const app = await createCliApp({
  name: 'acme',
  description: 'Acme operator CLI',
  version: '1.0.0',
  commands: [{ path: ['db', 'seed'], module: seed }],
  checks: [nodeVersion({ min: '22' }), pnpmVersion({ min: '11' }), postgresReachable({ url: process.env.DATABASE_URL! })],
  modules: [appModule], // enables ./serverkit lazy bootstrap
  plugins: { workspace: {} },
});

process.exit(await app.run());
```

A workspace plugin declares itself in its own `package.json`:

```json
{ "name": "@acme/billing", "johnny5": { "commands": "./src/cli/commands.ts" } }
```

…and default-exports a `PluginManifest`.

## Rules for generated code

- Wrap every command in `defineCommand` so `Opts` is inferred from the literal instead of being
  annotated by hand.
- Import each integration from its subpath (`/postgres`, `/serverkit`, `/keyring`, …), never from
  the root. That is what keeps eight optional peers optional.
- `createCliApp` is **async** and `app.run()` resolves with an exit code. Call `process.exit` on the
  result yourself — the framework does not.
- Mark destructive commands `dangerous` and gate them with `allowedEnvironments`. `dangerous` adds a
  `-y, --yes` flag and refuses to run unconfirmed; outside a TTY, `--yes` is mandatory.
- Put interactive prompting in the `interactive` hook, not in `run`. It only fires when stdin and
  stdout are both TTYs, which keeps `run` scriptable.
- Use `ctx.shell` rather than importing `execa` directly, and `ctx.daemons` for anything long-lived.
- Write doctor checks that always resolve. A throw is caught and rendered as a failure, but a
  `CheckResult` with a `fixHint` is far more useful.
- Supply `autoFix` when remediation is safe and idempotent — it runs under `--fix` for every failing
  check.
- Set `modules` on `CliAppOptions` when commands use `requireContainer`, or the ServerKit bootstrap
  hook is never installed.
- Return a non-zero number from `run` to signal failure rather than calling `process.exit` inside a
  command.

## Gotchas

- **`app.run()` does not exit the process.** It resolves with a code. Forgetting
  `process.exit(await app.run())` makes a failing command look successful to CI.
- **`modules` and the `./serverkit` import are coupled.** Setting `modules` triggers a dynamic
  import of the serverkit integration, but the docs also expect that subpath to be imported once
  for its side effect of installing the bootstrap hook. If `requireContainer` fails, check both.
- **A plugin that fails to load is a warning, not an error.** `loadWorkspacePlugins` logs through
  `ctx.logger.warn` and continues, so a broken plugin manifests as commands quietly missing from
  `--help`.
- **`repoRoot` is the consumer's workspace**, not where johnny5 is installed. A check that resolves
  paths against the wrong root silently passes or fails everywhere.
- **`dangerous: { confirm: 'typed' }` defaults `phrase` to the full command path**, so
  `acme db seed` requires typing `db seed` unless you override it.
- **`allowedEnvironments` reads `NODE_ENV` by default.** An unset `NODE_ENV` matches nothing, so the
  guard blocks the command outright rather than allowing it.
- **`passthrough` disables commander's error handling** for unknown options and excess arguments —
  they reach `run` verbatim. Useful for wrapping another CLI, and a footgun everywhere else.
- **`OptionSpec.envVar` is a fallback, not an override.** The flag wins when both are present.
- **`unwrap` throws `PromptCancelledError` on cancel.** A Ctrl-C in a prompt is an exception, not a
  falsy return; catch it if you want a clean exit.
- **`./bin` fixes real bugs in `@swc-node/register`'s stock shim**, notably that `esm-register`
  resolves the loader hook relative to `process.cwd()` and breaks when the bin runs from elsewhere.
  Use `runTypescriptBin` rather than importing the shim directly.
- **Eight optional peers is a lot of ways to get a module-resolution error at startup.** A missing
  peer fails at import time, not at first use.

## Working inside this package

```
src/
  index.ts                   Root barrel (explicit named exports, not export *)
  app.ts                     createCliApp, defineCommand, CliApp(Options)
  context.ts                 buildContext, buildDefaultAppConfig
  types.ts                   Every declarative type: CommandModule, Check, CliContext, specs
  bin.shim.ts                ./bin entry — registerTypescriptLoader, runTypescriptBin
  commander/register.ts      registerCommands — builds the commander tree
  commander/safety.ts        checkEnvironmentGuard, confirmDangerous, needsYesOption (internal)
  doctor/runner.ts           runChecks, buildDoctorCommand
  plugin/workspace.loader.ts loadWorkspacePlugins
  util/                      logger, shell, daemons, paths, prompts, tty, wizard
  integrations/              config.values + one folder per subpath: serverkit, postgres, redis,
                             docker, versions, filesystem, kysely, permissions, keyring
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import any of the eight optional peers.** Every
  integration lives behind its own subpath entry for exactly that reason, and `src/index.ts` uses
  explicit named exports (not `export *`) so a new file cannot leak one in by accident.
- `app.run()` resolves with an exit code and never calls `process.exit` itself.
- The safety controls — `dangerous` confirmation and `allowedEnvironments` — must run before `run`,
  and non-interactive contexts must require `--yes` rather than assuming consent.
- The `interactive` hook only fires on a TTY. Commands must stay fully scriptable without it.
- A plugin load failure must stay non-fatal.
- The `"johnny5"` `package.json` field and the default-exported `PluginManifest` are a discovery
  contract with consuming workspaces.
- A new integration gets its own `src/integrations/<name>/index.ts`, an `exports` entry, a tsup
  entry in the `build` script, and its dependency under `peerDependenciesMeta` as optional.

User-visible changes need a changeset in `.changeset/`.
