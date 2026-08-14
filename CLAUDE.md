# CLAUDE.md

The guidance for this repo lives in [AGENTS.md](./AGENTS.md), so every tool reads the same file.

@AGENTS.md

Each package has its own `packages/<name>/AGENTS.md` covering its API surface, canonical wiring,
and gotchas. Read it before generating code against that package. When writing a new one, start
from [.claude/templates/agents.template.md](./.claude/templates/agents.template.md).
