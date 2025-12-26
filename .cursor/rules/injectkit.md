# Dependency Injection (injectkit)

All services must be decorated with `@Injectable()` and registered in a setup function.

## Service Pattern

```typescript
import { Injectable } from 'injectkit';

@Injectable()
export class MyService {
    constructor(
        private readonly logger: Logger,
        private readonly repository: MyRepository
    ) {}

    async doSomething(): Promise<void> {
        // implementation
    }
}
```

## Registration Pattern

```typescript
import { Registry } from 'injectkit';
import { AppConfig } from '@archivist/appconfig';

export const setupMyModule = async (registry: Registry, config: AppConfig) => {
    // Register dependencies first
    registry.register(MyRepository).useClass(MyRepository).asSingleton();

    // Then register services that depend on them
    registry.register(MyService).useClass(MyService).asSingleton();
};
```

## Setup Function Pattern

```typescript
export const setupFeature = async (registry: Registry, config: AppConfig) => {
    // 1. Read config values
    const apiKey = config.getString('FEATURE_API_KEY');

    // 2. Create instances that need config
    const client = new FeatureClient(apiKey);

    // 3. Register instances
    registry.register(FeatureClient).useInstance(client);

    // 4. Register classes
    registry.register(FeatureService).useClass(FeatureService).asSingleton();
};
```

---

## Lifetime Guidelines

- **Singleton (`asSingleton()`):** Database connections
- **Transient (`asTransient()`):** Jobs, request-specific handlers, repositories, most services
- **Scoped (`asScoped()`):** Per-request context (rarely used)

---

## Resolving Services in Routes

```typescript
DocumentsRouter.post('/documents', async (ctx, next) => {
    const documentService = ctx.serviceContainer.get(DocumentService);
    // use service
    await next();
});
```
