# TypeScript Conventions

## ESM Modules

- Use ESM modules exclusively (`"type": "module"`)
- Always use `.js` extension in imports (even for `.ts` files)
- Use strict TypeScript settings

```typescript
// ✅ Correct import with .js extension
import { DocumentService } from './document.service.js';

// ❌ Wrong - missing .js extension
import { DocumentService } from './document.service';
```

## Type Definitions

- Prefer `interface` for object shapes, `type` for unions/intersections
- Use `readonly` for injected dependencies in constructors

---

## Path Aliases (apps/api)

The API app uses `#` prefixed path aliases:

- `#modules/*` → `src/modules/*`
- `#data/*` → `src/modules/data/*`
- `#middleware/*` → `src/middleware/*`
- `#routes/*` → `src/routes/*`
- `#jobs/*` → `src/modules/jobs/*`
- `#ai/*` → `src/modules/ai/*`

```typescript
// ✅ Using path aliases
import { DocumentsRepository } from '#data/repositories/documents.repository.js';

// ✅ Relative imports for same module
import { StorageClient } from './storage/storage.client.js';
```

---

## Workspace Dependencies

Use `workspace:*` for internal package dependencies:

```json
{
    "dependencies": {
        "@archivist/logger": "workspace:*",
        "@archivist/errors": "workspace:*"
    }
}
```
