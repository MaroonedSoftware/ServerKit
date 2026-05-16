import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { kyselyTableExists } from '../../src/integrations/kysely/index.js';
import { createMockContext } from '../helpers.js';

interface FakeIntrospectionResult {
    name: string;
    schema?: string;
}

const fakeDb = (tables: FakeIntrospectionResult[] | Error): Kysely<unknown> =>
    ({
        introspection: {
            getTables: vi.fn(async () => {
                if (tables instanceof Error) throw tables;
                return tables;
            }),
        },
    }) as unknown as Kysely<unknown>;

describe('kyselyTableExists', () => {
    it('passes when the table is present', async () => {
        const check = kyselyTableExists({
            db: fakeDb([{ name: 'relation_tuples' }, { name: 'jobs' }]),
            table: 'relation_tuples',
        });
        const result = await check.run(createMockContext());
        expect(result.ok).toBe(true);
        expect(result.message).toBe('relation_tuples exists');
    });

    it('fails with a migration hint when the table is missing', async () => {
        const check = kyselyTableExists({
            db: fakeDb([{ name: 'jobs' }]),
            table: 'relation_tuples',
        });
        const result = await check.run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toBe('relation_tuples not found');
        expect(result.fixHint).toContain('migrations');
    });

    it('matches the schema when one is supplied', async () => {
        const tables: FakeIntrospectionResult[] = [
            { name: 'relation_tuples', schema: 'public' },
            { name: 'relation_tuples', schema: 'auth' },
        ];
        const ok = await kyselyTableExists({ db: fakeDb(tables), table: 'relation_tuples', schema: 'auth' }).run(createMockContext());
        expect(ok.ok).toBe(true);
        expect(ok.message).toBe('auth.relation_tuples exists');

        const miss = await kyselyTableExists({ db: fakeDb(tables), table: 'relation_tuples', schema: 'archive' }).run(createMockContext());
        expect(miss.ok).toBe(false);
    });

    it('reports introspection failures as a failing check', async () => {
        const check = kyselyTableExists({
            db: fakeDb(new Error('connection refused')),
            table: 'whatever',
        });
        const result = await check.run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toContain('connection refused');
    });

    it('uses the table name as the check name', () => {
        expect(kyselyTableExists({ db: fakeDb([]), table: 'jobs' }).name).toBe('table jobs exists');
        expect(kyselyTableExists({ db: fakeDb([]), table: 'jobs', schema: 'public' }).name).toBe('table public.jobs exists');
    });
});
