import { describe, it, expectTypeOf } from 'vitest';
import type { Kysely, Transaction } from 'kysely';
import { KyselyTransactionConnectionProvider, type KyselyLike } from '../../src/pgboss/kysely.transaction.connection.provider.js';

interface TestDB {
  job: { id: string; created_on: string };
}

/**
 * `KyselyLike` is declared structurally so the package needs no dependency on
 * `kysely`, which means nothing but these assertions keeps it in step with the
 * real Kysely types. Tightening `KyselyLike` (or a breaking change upstream)
 * would only surface here.
 */
describe('KyselyLike', () => {
  it('is satisfied by a Kysely instance and by a transaction', () => {
    expectTypeOf<Kysely<TestDB>>().toExtend<KyselyLike>();
    expectTypeOf<Transaction<TestDB>>().toExtend<KyselyLike>();
  });

  it('lets both be passed to the provider with no type argument and no cast', () => {
    expectTypeOf(KyselyTransactionConnectionProvider).toBeConstructibleWith({} as Kysely<TestDB>);
    expectTypeOf(KyselyTransactionConnectionProvider).toBeConstructibleWith({} as Transaction<TestDB>);
  });

  it('is not satisfied by an object missing withoutPlugins', () => {
    expectTypeOf<{ executeQuery: () => Promise<{ rows: never[] }> }>().not.toExtend<KyselyLike>();
  });
});
