import { describe, it, expect } from 'vitest';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';

describe('PgBossConnectionProvider', () => {
  it('returns undefined by default so pg-boss uses its own pool', () => {
    const provider = new PgBossConnectionProvider();

    expect(provider.executor()).toBeUndefined();
  });

  it('lets subclasses supply a transaction-bound executor', () => {
    const executor = { executeSql: async () => ({ rows: [] }) };

    class TransactionalProvider extends PgBossConnectionProvider {
      override executor() {
        return executor;
      }
    }

    expect(new TransactionalProvider().executor()).toBe(executor);
  });
});
