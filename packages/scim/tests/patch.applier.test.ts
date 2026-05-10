import { describe, expect, it } from 'vitest';
import { applyScimPatch } from '../src/patch/patch.applier.js';

describe('applyScimPatch', () => {
  describe('add', () => {
    it('sets a missing top-level attribute', () => {
      const out = applyScimPatch({ id: '1' }, [{ op: 'add', path: 'displayName', value: 'Bob' }]);
      expect(out).toEqual({ id: '1', displayName: 'Bob' });
    });

    it('appends to a multi-valued attribute', () => {
      const out = applyScimPatch(
        { emails: [{ value: 'a@example.com' }] },
        [{ op: 'add', path: 'emails', value: [{ value: 'b@example.com' }] }],
      );
      expect(out.emails).toEqual([{ value: 'a@example.com' }, { value: 'b@example.com' }]);
    });

    it('shallow-merges sub-attributes via dotted path', () => {
      const out = applyScimPatch(
        { name: { givenName: 'Bob' } },
        [{ op: 'add', path: 'name.familyName', value: 'Builder' }],
      );
      expect(out.name).toEqual({ givenName: 'Bob', familyName: 'Builder' });
    });

    it('pathless add deep-merges nested objects', () => {
      const out = applyScimPatch(
        { name: { givenName: 'Bob' }, displayName: 'Bob' },
        [{ op: 'add', value: { name: { familyName: 'Builder' }, active: true } }],
      );
      expect(out).toEqual({
        name: { givenName: 'Bob', familyName: 'Builder' },
        displayName: 'Bob',
        active: true,
      });
    });
  });

  describe('replace', () => {
    it('overwrites a top-level attribute', () => {
      const out = applyScimPatch({ active: true }, [{ op: 'replace', path: 'active', value: false }]);
      expect(out.active).toBe(false);
    });

    it('overwrites a sub-attribute via dotted path', () => {
      const out = applyScimPatch(
        { name: { givenName: 'Bob', familyName: 'Builder' } },
        [{ op: 'replace', path: 'name.givenName', value: 'Robert' }],
      );
      expect(out.name).toEqual({ givenName: 'Robert', familyName: 'Builder' });
    });

    it('replaces a matched value-path item', () => {
      const out = applyScimPatch(
        { emails: [{ value: 'old@example.com', type: 'work' }, { value: 'home@example.com', type: 'home' }] },
        [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'new@example.com' }],
      );
      expect(out.emails).toEqual([
        { value: 'new@example.com', type: 'work' },
        { value: 'home@example.com', type: 'home' },
      ]);
    });

    it('pathless replace shallow-merges into the resource', () => {
      const out = applyScimPatch({ a: 1, b: 2 }, [{ op: 'Replace', value: { b: 20, c: 3 } }]);
      expect(out).toEqual({ a: 1, b: 20, c: 3 });
    });
  });

  describe('remove', () => {
    it('drops a top-level attribute', () => {
      const out = applyScimPatch({ a: 1, b: 2 }, [{ op: 'remove', path: 'a' }]);
      expect(out).toEqual({ b: 2 });
    });

    it('removes a matched value-path item', () => {
      const out = applyScimPatch(
        { emails: [{ value: 'work@x.com', type: 'work' }, { value: 'home@x.com', type: 'home' }] },
        [{ op: 'remove', path: 'emails[type eq "home"]' }],
      );
      expect(out.emails).toEqual([{ value: 'work@x.com', type: 'work' }]);
    });

    it('throws noTarget if no items match', () => {
      try {
        applyScimPatch(
          { emails: [{ value: 'work@x.com', type: 'work' }] },
          [{ op: 'remove', path: 'emails[type eq "home"]' }],
        );
        expect.fail('expected throw');
      } catch (error) {
        expect(error).toMatchObject({
          statusCode: 400,
          scimType: 'noTarget',
          details: { message: expect.stringMatching(/No items matched/) },
        });
      }
    });

    it('throws noTarget without a path', () => {
      try {
        applyScimPatch({ a: 1 }, [{ op: 'remove' }]);
        expect.fail('expected throw');
      } catch (error) {
        expect(error).toMatchObject({
          statusCode: 400,
          scimType: 'noTarget',
          details: { message: expect.stringMatching(/requires a path/) },
        });
      }
    });
  });

  it('does not mutate the input', () => {
    const input = { name: { givenName: 'Bob' }, emails: [{ value: 'x' }] };
    applyScimPatch(input, [{ op: 'add', path: 'name.familyName', value: 'Builder' }]);
    expect(input).toEqual({ name: { givenName: 'Bob' }, emails: [{ value: 'x' }] });
  });

  it('rejects unknown op kinds', () => {
    try {
      applyScimPatch({}, [{ op: 'unknown' as 'add' }]);
      expect.fail('expected throw');
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        scimType: 'invalidSyntax',
        details: { message: expect.stringMatching(/Unknown PATCH op/) },
      });
    }
  });

  it('applies multiple ops in order', () => {
    const out = applyScimPatch({ active: true }, [
      { op: 'add', path: 'displayName', value: 'Bob' },
      { op: 'replace', path: 'active', value: false },
      { op: 'remove', path: 'displayName' },
    ]);
    expect(out).toEqual({ active: false });
  });
});
