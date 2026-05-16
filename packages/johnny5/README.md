# @maroonedsoftware/johnny5

A CLI framework for ServerKit-based applications. Provides:

- **`createCliApp`** — single-call factory that wires a `commander` program from a list of `CommandModule` definitions.
- **Doctor runner** — built-in `doctor` subcommand backed by a list of `Check` objects, with optional `--fix` auto-remediation.
- **Plugin discovery** — workspace packages can register additional commands by declaring `"johnny5": { "commands": "./path.js" }` in their `package.json`; collisions with core commands throw at startup.
- **ServerKit integration** (subpath `/serverkit`) — `bootstrapForCli` runs each `ServerKitModule.setup()` (but not `start()`) and gives commands a scoped InjectKit container via `requireContainer`.
- **Opt-in check libraries** under subpath exports — `/postgres`, `/redis`, `/docker`, `/versions`, `/filesystem`. Each is a tiny module so non-Postgres (or non-Redis, etc.) consumers don't pull the underlying drivers.

## Install

```bash
pnpm add @maroonedsoftware/johnny5
# plus whichever optional peers your CLI needs:
pnpm add pg ioredis kysely
```

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

`my-cli doctor` auto-registers because `checks` is non-empty. `my-cli hello --name alice` invokes the registered command. Add `modules: [...]` to enable the ServerKit integration and use `requireContainer` for commands that need DI-resolved services.

## License

MIT
