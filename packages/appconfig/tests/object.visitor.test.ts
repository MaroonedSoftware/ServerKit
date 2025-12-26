import { describe, it, expect, vi } from 'vitest';
import { objectVisitor } from '../src/object.visitor.js';

describe('objectVisitor', () => {
  describe('primitive values', () => {
    it('should call callback for string values', () => {
      const callback = vi.fn();
      const obj = { name: 'John' };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('John', {
        owner: obj,
        propertyPath: 'name',
        path: 'name',
        propertyType: 'string',
      });
    });

    it('should call callback for number values', () => {
      const callback = vi.fn();
      const obj = { age: 30 };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(30, {
        owner: obj,
        propertyPath: 'age',
        path: 'age',
        propertyType: 'number',
      });
    });

    it('should call callback for boolean values', () => {
      const callback = vi.fn();
      const obj = { active: true };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(true, {
        owner: obj,
        propertyPath: 'active',
        path: 'active',
        propertyType: 'boolean',
      });
    });

    it('should call callback for bigint values', () => {
      const callback = vi.fn();
      const bigIntValue = BigInt(123);
      const obj = { id: bigIntValue };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(bigIntValue, {
        owner: obj,
        propertyPath: 'id',
        path: 'id',
        propertyType: 'bigint',
      });
    });
  });

  describe('nested objects', () => {
    it('should traverse nested objects', () => {
      const callback = vi.fn();
      const obj = {
        user: {
          name: 'John',
          age: 30,
        },
      };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith('John', {
        owner: obj.user,
        propertyPath: 'name',
        path: 'user.name',
        propertyType: 'string',
      });
      expect(callback).toHaveBeenCalledWith(30, {
        owner: obj.user,
        propertyPath: 'age',
        path: 'user.age',
        propertyType: 'number',
      });
    });

    it('should handle deeply nested objects', () => {
      const callback = vi.fn();
      const obj = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('deep', {
        owner: obj.level1.level2.level3,
        propertyPath: 'value',
        path: 'level1.level2.level3.value',
        propertyType: 'string',
      });
    });
  });

  describe('arrays', () => {
    it('should traverse array elements', () => {
      const callback = vi.fn();
      const obj = {
        items: ['a', 'b', 'c'],
      };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith('a', {
        owner: obj.items,
        propertyPath: 'items[0]',
        path: 'items[0]',
        propertyType: 'string',
        arrayIndex: 0,
      });
      expect(callback).toHaveBeenCalledWith('b', {
        owner: obj.items,
        propertyPath: 'items[1]',
        path: 'items[1]',
        propertyType: 'string',
        arrayIndex: 1,
      });
      expect(callback).toHaveBeenCalledWith('c', {
        owner: obj.items,
        propertyPath: 'items[2]',
        path: 'items[2]',
        propertyType: 'string',
        arrayIndex: 2,
      });
    });

    it('should traverse nested arrays', () => {
      const callback = vi.fn();
      const obj = {
        matrix: [
          [1, 2],
          [3, 4],
        ],
      };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(4);
      expect(callback).toHaveBeenCalledWith(1, {
        owner: obj.matrix[0],
        propertyPath: 'matrix[0][0]',
        path: 'matrix[0][0]',
        propertyType: 'number',
        arrayIndex: 0,
      });
      expect(callback).toHaveBeenCalledWith(2, {
        owner: obj.matrix[0],
        propertyPath: 'matrix[0][1]',
        path: 'matrix[0][1]',
        propertyType: 'number',
        arrayIndex: 1,
      });
      expect(callback).toHaveBeenCalledWith(3, {
        owner: obj.matrix[1],
        propertyPath: 'matrix[1][0]',
        path: 'matrix[1][0]',
        propertyType: 'number',
        arrayIndex: 0,
      });
      expect(callback).toHaveBeenCalledWith(4, {
        owner: obj.matrix[1],
        propertyPath: 'matrix[1][1]',
        path: 'matrix[1][1]',
        propertyType: 'number',
        arrayIndex: 1,
      });
    });

    it('should handle arrays of objects', () => {
      const callback = vi.fn();
      const obj = {
        users: [
          { name: 'John', age: 30 },
          { name: 'Jane', age: 25 },
        ],
      };
      objectVisitor(obj, callback);
      expect(callback).toHaveBeenCalledTimes(4);
      expect(callback).toHaveBeenCalledWith('John', {
        owner: obj.users[0],
        propertyPath: 'name',
        path: 'users[0].name',
        propertyType: 'string',
        arrayIndex: undefined,
      });
      expect(callback).toHaveBeenCalledWith(30, {
        owner: obj.users[0],
        propertyPath: 'age',
        path: 'users[0].age',
        propertyType: 'number',
        arrayIndex: undefined,
      });
      expect(callback).toHaveBeenCalledWith('Jane', {
        owner: obj.users[1],
        propertyPath: 'name',
        path: 'users[1].name',
        propertyType: 'string',
        arrayIndex: undefined,
      });
      expect(callback).toHaveBeenCalledWith(25, {
        owner: obj.users[1],
        propertyPath: 'age',
        path: 'users[1].age',
        propertyType: 'number',
        arrayIndex: undefined,
      });
    });
  });

  describe('edge cases', () => {
    it('should not call callback for null', () => {
      const callback = vi.fn();
      const obj = { value: null };
      objectVisitor(obj, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call callback for undefined', () => {
      const callback = vi.fn();
      const obj = { value: undefined };
      objectVisitor(obj, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call callback for functions', () => {
      const callback = vi.fn();
      const obj = { fn: () => {} };
      objectVisitor(obj, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call callback for symbols', () => {
      const callback = vi.fn();
      const sym = Symbol('test');
      const obj = { symbol: sym };
      objectVisitor(obj, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle empty objects', () => {
      const callback = vi.fn();
      const obj = {};
      objectVisitor(obj, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle empty arrays', () => {
      const callback = vi.fn();
      const obj = { items: [] };
      objectVisitor(obj, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle null root object', () => {
      const callback = vi.fn();
      objectVisitor(null, callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle undefined root object', () => {
      const callback = vi.fn();
      objectVisitor(undefined, callback);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('complex structures', () => {
    it('should handle mixed structures', () => {
      const callback = vi.fn();
      const obj = {
        name: 'John',
        age: 30,
        address: {
          street: '123 Main St',
          city: 'New York',
        },
        tags: ['developer', 'engineer'],
        metadata: {
          active: true,
          scores: [95, 87, 92],
        },
      };
      objectVisitor(obj, callback);
      // name, age, street, city, tags[0], tags[1], active, scores[0], scores[1], scores[2] = 10
      expect(callback).toHaveBeenCalledTimes(10);
    });

    it('should provide correct meta information for all values', () => {
      const callback = vi.fn();
      const obj = {
        top: 'value',
        nested: {
          deep: {
            value: 42,
          },
        },
        array: ['a', 'b'],
      };
      objectVisitor(obj, callback);

      const calls = callback.mock.calls;
      expect(calls[0][1].path).toBe('top');
      expect(calls[1][1].path).toBe('nested.deep.value');
      expect(calls[2][1].path).toBe('array[0]');
      expect(calls[3][1].path).toBe('array[1]');
    });
  });
});
