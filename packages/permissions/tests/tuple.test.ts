import { describe, it, expect } from 'vitest';
import { ObjectRef, RelationTuple, SubjectRef, formatSubject, parseSubject, parseTuple, stringifyTuple } from '../src/tuple.js';

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

    it('rejects an id containing a structural character', () => {
        expect(() => ObjectRef.parse({ namespace: 'doc', id: 'a.b' })).toThrow();
        expect(() => ObjectRef.parse({ namespace: 'doc', id: 'a:b' })).toThrow();
        expect(() => ObjectRef.parse({ namespace: 'doc', id: 'a@b' })).toThrow();
        expect(() => ObjectRef.parse({ namespace: 'doc', id: '*' })).toThrow();
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
        expect(stringifyTuple(t)).toBe('doc:doc-1.viewer@user:alice');
    });

    it('renders a wildcard subject as `<ns>.*`', () => {
        const t: RelationTuple = {
            object: { namespace: 'doc', id: 'doc-1' },
            relation: 'viewer',
            subject: { kind: 'wildcard', namespace: 'user' },
        };
        expect(stringifyTuple(t)).toBe('doc:doc-1.viewer@user.*');
    });

    it('renders a userset subject with a `.relation` suffix', () => {
        const t: RelationTuple = {
            object: { namespace: 'doc', id: 'doc-1' },
            relation: 'viewer',
            subject: { kind: 'userset', namespace: 'org', id: '42', relation: 'admin' },
        };
        expect(stringifyTuple(t)).toBe('doc:doc-1.viewer@org:42.admin');
    });
});

describe('formatSubject', () => {
    it('formats every subject kind in canonical form', () => {
        expect(formatSubject({ kind: 'concrete', namespace: 'user', id: 'alice' })).toBe('user:alice');
        expect(formatSubject({ kind: 'wildcard', namespace: 'user' })).toBe('user.*');
        expect(formatSubject({ kind: 'userset', namespace: 'org', id: '42', relation: 'admin' })).toBe('org:42.admin');
    });
});

describe('parseSubject', () => {
    it('parses concrete, wildcard, and userset forms', () => {
        expect(parseSubject('user:alice')).toEqual({ kind: 'concrete', namespace: 'user', id: 'alice' });
        expect(parseSubject('user.*')).toEqual({ kind: 'wildcard', namespace: 'user' });
        expect(parseSubject('org:42.admin')).toEqual({ kind: 'userset', namespace: 'org', id: '42', relation: 'admin' });
    });

    it('throws on malformed input', () => {
        expect(() => parseSubject('no-separator')).toThrow();
        expect(() => parseSubject('Org:42.admin')).toThrow();
        expect(() => parseSubject('org:42.Admin')).toThrow();
        expect(() => parseSubject('userset-without-id:.admin')).toThrow();
        expect(() => parseSubject('user:alice.*')).toThrow();
    });
});

describe('parseTuple', () => {
    const cases: Array<[string, RelationTuple]> = [
        [
            'doc:doc-1.viewer@user:alice',
            {
                object: { namespace: 'doc', id: 'doc-1' },
                relation: 'viewer',
                subject: { kind: 'concrete', namespace: 'user', id: 'alice' },
            },
        ],
        [
            'doc:doc-1.viewer@user.*',
            {
                object: { namespace: 'doc', id: 'doc-1' },
                relation: 'viewer',
                subject: { kind: 'wildcard', namespace: 'user' },
            },
        ],
        [
            'doc:doc-1.viewer@org:42.admin',
            {
                object: { namespace: 'doc', id: 'doc-1' },
                relation: 'viewer',
                subject: { kind: 'userset', namespace: 'org', id: '42', relation: 'admin' },
            },
        ],
    ];

    it('round-trips with stringifyTuple', () => {
        for (const [s, t] of cases) {
            expect(parseTuple(s)).toEqual(t);
            expect(stringifyTuple(t)).toBe(s);
        }
    });

    it('throws on missing @ or relation separator', () => {
        expect(() => parseTuple('doc:doc-1.viewer-user:alice')).toThrow();
        expect(() => parseTuple('doc:doc-1@user:alice')).toThrow();
    });
});
