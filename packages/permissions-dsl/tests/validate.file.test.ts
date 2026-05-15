import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser.js';
import { validateFile } from '../src/validate.js';
import { CompileError } from '../src/diagnostics.js';

describe('validateFile', () => {
    it('returns lowered output on success', () => {
        const source = `namespace user { relation self: user }`;
        const result = validateFile({ source, filename: 'user.perm' });
        expect(result.error).toBeUndefined();
        expect(result.lowered).toBeDefined();
        expect(result.lowered!.namespaces).toHaveLength(1);
        expect(result.lowered!.namespaces[0]!.name).toBe('user');
    });

    it('returns a CompileError on lowering failure without throwing', () => {
        // Parses fine; fails lower because `ghost` is not a declared namespace.
        const source = `namespace doc { relation owner: ghost }`;
        const result = validateFile({ source, filename: 'doc.perm' });
        expect(result.error).toBeInstanceOf(CompileError);
        expect(result.lowered).toBeUndefined();
        expect(result.file.namespaces).toHaveLength(1);
    });

    it('resolves cross-file references via siblings', () => {
        const userFile = parse({ source: `namespace user { relation self: user }`, filename: 'user.perm' });
        const docSource = `namespace doc { relation owner: user permission edit = owner }`;
        const result = validateFile({ source: docSource, filename: 'doc.perm', siblings: userFile.namespaces });
        expect(result.error).toBeUndefined();
        expect(result.lowered).toBeDefined();
    });

    it('local namespaces take precedence over siblings on name collisions', () => {
        // Provide a sibling "user" with a different shape; the local file's
        // namespace should be the one validated against.
        const otherUser = parse({ source: `namespace user { relation other: user }`, filename: 'other.perm' });
        const result = validateFile({
            source: `namespace user { relation self: user }\nnamespace doc { relation owner: user }`,
            filename: 'doc.perm',
            siblings: otherUser.namespaces,
        });
        expect(result.error).toBeUndefined();
        expect(result.file.namespaces.map(n => n.name)).toEqual(['user', 'doc']);
    });
});
