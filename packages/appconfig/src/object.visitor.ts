/**
 * Metadata about a value's location within an object structure.
 */
export type ObjectVisitorMeta = {
  /** The full path to the value (e.g., "database.host" or "items[0]"). */
  path: string;
  /** The object that owns this property. */
  owner: object;
  /** The property name or array index path (e.g., "host" or "items[0]"). */
  propertyPath: string;
  /** The type of the property value. */
  propertyType: 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function';
  /** The array index if the value is in an array, undefined otherwise. */
  arrayIndex?: number;
};

/**
 * Callback function invoked for each primitive value found during object traversal.
 *
 * @param value - The primitive value found.
 * @param meta - Metadata about the value's location in the object structure.
 */
export type ObjectVisitorCallback = (value: unknown, meta: ObjectVisitorMeta) => void;

/**
 * Traverses an object structure and invokes a callback for each primitive value found.
 *
 * The visitor recursively traverses objects and arrays, calling the callback for each
 * primitive value (string, number, boolean, bigint) encountered. It skips functions,
 * symbols, null, and undefined values.
 *
 * @param obj - The object to traverse. Can be any value.
 * @param callback - The callback function to invoke for each primitive value.
 *
 * @example
 * ```typescript
 * const config = {
 *   database: { host: 'localhost', port: 5432 },
 *   items: ['a', 'b', 'c']
 * };
 *
 * objectVisitor(config, (value, meta) => {
 *   console.log(`${meta.path} = ${value}`);
 * });
 * // Output:
 * // database.host = localhost
 * // database.port = 5432
 * // items[0] = a
 * // items[1] = b
 * // items[2] = c
 * ```
 */
export const objectVisitor = (obj: unknown, callback: ObjectVisitorCallback): void => {
  const visit = (
    obj: unknown,
    callback: ObjectVisitorCallback,
    path: string = '',
    owner: object = {},
    propertyPath: string = '',
    arrayIndex?: number,
  ): void => {
    if (!obj) {
      return;
    }

    switch (typeof obj) {
      case 'object':
        if (Array.isArray(obj)) {
          obj.forEach((item, index) => {
            visit(item, callback, path + `[${index}]`, obj, propertyPath + `[${index}]`, index);
          });
        } else {
          const entries = Object.entries(obj);
          for (const entry of entries) {
            visit(entry[1], callback, path + (path.length > 0 ? '.' : '') + entry[0], obj, entry[0]);
          }
        }
        break;
      case 'function':
      case 'symbol':
      case 'undefined':
        break;
      default:
        callback(obj, {
          owner,
          propertyPath,
          path,
          propertyType: typeof obj,
          arrayIndex,
        });
        break;
    }
  };

  visit(obj, callback);
};
