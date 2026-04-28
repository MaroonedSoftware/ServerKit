import { describe, it, expect } from 'vitest';
import { ObjectRef, RelationTuple, SubjectRef, stringifyTuple } from '../src/tuple.js';

describe('ObjectRef schema', () => {
    it('accepts a well-formed ref', () => {
        expect(ObjectRef.parse({ namespace: 'doc', id: 'doc-1' })).toEqual({ namespace: 'doc', id: 'doc-1' });
    });

    it('rejects a malformed namespace', () => {
        expect(() => ObjectRef.parse({ namespace: 'Doc', id: 'doc-1' })).toThrow();
    });

    it('rejects an empty id', () => {
        expect(() => ObjectRef.parse({ namespace: 'doc', id: '' })).toThrow();
    });
});

describe('SubjectRef schema', () => {
    it('parses a concrete subject', () => {
        expect(SubjectRef.parse({ kind: 'concrete', namespace: 'user', id: 'alice' })).toMatchObject({
            kind: 'concrete',
            id: 'alice',
        });
    });

    it('parses a wildcard subject', () => {
        expect(SubjectRef.parse({ kind: 'wildcard', namespace: 'user' })).toMatchObject({
            kind: 'wildcard',
            namespace: 'user',
        });
    });

    it('parses a userset subject', () => {
        expect(SubjectRef.parse({ kind: 'userset', namespace: 'org', id: '42', relation: 'admin' })).toMatchObject({
            kind: 'userset',
            relation: 'admin',
        });
    });

    it('rejects a userset with a malformed relation', () => {
        expect(() => SubjectRef.parse({ kind: 'userset', namespace: 'org', id: '42', relation: 'Admin' })).toThrow();
    });
});

describe('stringifyTuple', () => {
    it('renders a concrete-subject tuple in canonical form', () => {
        const t: RelationTuple = {
            object: { namespace: 'doc', id: 'doc-1' },
            relation: 'viewer',
            subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
        };
        expect(stringifyTuple(t)).toBe('doc:doc-1#viewer@user:alice');
    });

    it('renders a wildcard subject as `<ns>:*`', () => {
        const t: RelationTuple = {
            object: { namespace: 'doc', id: 'doc-1' },
            relation: 'viewer',
            subject: { kind: 'wildcard', namespace: 'user' },
        };
        expect(stringifyTuple(t)).toBe('doc:doc-1#viewer@user:*');
    });

    it('renders a userset subject with a `#relation` suffix', () => {
        const t: RelationTuple = {
            object: { namespace: 'doc', id: 'doc-1' },
            relation: 'viewer',
            subject: { kind: 'userset', namespace: 'org', id: '42', relation: 'admin' },
        };
        expect(stringifyTuple(t)).toBe('doc:doc-1#viewer@org:42#admin');
    });
});
