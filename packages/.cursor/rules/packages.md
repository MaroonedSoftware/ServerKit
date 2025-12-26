# Package Development

## Package Structure

```
packages/
  my-package/
    src/
      index.ts           # Public exports
      feature.ts         # Implementation
    tests/
      setup.ts
      feature.test.ts
    package.json
    tsconfig.json
    vitest.config.ts
    eslint.config.js
```

---

## Package.json Pattern

```json
{
    "name": "@maroonedsoftware/my-package",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "module": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
        "build": "tsup src/index.ts --format esm --sourcemap --dts && tsc --emitDeclarationOnly --declaration",
        "lint": "eslint --fix",
        "format": "prettier --write",
        "test": "vitest run"
    },
    "devDependencies": {
        "@repo/config-eslint": "workspace:*",
        "@repo/config-typescript": "workspace:*"
    }
}
```

---

## Testing

Use Vitest with the following structure:

```
package-name/
  src/
  tests/
    setup.ts                # Test setup file
    feature-name/
        feature.test.ts     # Test files
        specific.test.ts    # Sub-tests if needed
```

### Test File Pattern

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MyService } from '../src/my.service.js';

describe('MyService', () => {
    let service: MyService;

    beforeEach(() => {
        service = new MyService(/* mocks */);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('methodName', () => {
        it('should do something specific', () => {
            const result = service.methodName();
            expect(result).toBe(expected);
        });

        it('should handle edge case', () => {
            // test edge case
        });
    });
});
```
