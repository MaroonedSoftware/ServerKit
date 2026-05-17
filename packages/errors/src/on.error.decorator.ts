/* eslint-disable @typescript-eslint/no-unsafe-function-type */

/**
 * Type definition for an error handler function.
 * Called when an error is caught in a decorated method, getter, or setter.
 */
type ErrorHandler = (error: Error) => void;

/**
 * Generates a property descriptor that wraps the original method/getter/setter with error handling.
 * For methods, handles both synchronous and asynchronous errors.
 * For getters/setters, wraps the accessor with try-catch.
 *
 * @param descriptor - The original property descriptor to wrap.
 * @param handler - The error handler function to call when an error occurs.
 * @returns A new property descriptor with error handling.
 */
const generateDescriptor = (descriptor: PropertyDescriptor, handler: ErrorHandler): PropertyDescriptor => {
  if (!descriptor.value) {
    const getter = descriptor.get;
    const setter = descriptor.set;

    if (getter) {
      descriptor.get = function () {
        try {
          return getter.apply(this);
        } catch (error) {
          handler(error as Error);
          throw error;
        }
      };
    }

    if (setter) {
      descriptor.set = function (v: unknown) {
        try {
          return setter.apply(this, [v]);
        } catch (error) {
          handler(error as Error);
          throw error;
        }
      };
    }

    return descriptor;
  }

  const method = descriptor.value;

  descriptor.value = function (...args: unknown[]) {
    try {
      const result = method.apply(this, args);

      if (result && result instanceof Promise) {
        return result.catch((error: unknown) => {
          handler(error as Error);
          throw error;
        });
      }

      return result;
    } catch (error) {
      handler(error as Error);
      throw error;
    }
  };

  return descriptor;
};

/**
 * Class decorator that automatically wraps all methods, getters, and setters in a class
 * with error handling. When any decorated method throws an error (synchronously or asynchronously),
 * the provided error handler is invoked and then the original error is **re-thrown** so the
 * caller's `try`/`catch` still observes the failure. Handlers that want to map an error to a
 * different type (e.g. {@link PostgresErrorHandler}) should throw their replacement — that
 * throw short-circuits the re-throw and the mapped error reaches the caller instead.
 *
 * The decorator:
 * - Wraps all methods (including async methods) with try-catch
 * - Wraps getters and setters with try-catch
 * - Does not wrap the constructor
 * - Does not wrap non-method properties
 *
 * @param handler - The error handler function. Receives the caught error; may either return
 *   (in which case the original error is re-thrown after the handler runs) or throw a replacement.
 * @returns A class decorator function.
 *
 * @example
 * ```ts
 * @OnError((error) => {
 *   console.error('Error caught:', error);
 *   throw new HttpError(500).withCause(error);
 * })
 * class MyService {
 *   async doSomething() {
 *     throw new Error('Something went wrong');
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * @OnError(PostgresErrorHandler)
 * class UserRepository {
 *   async findById(id: number) {
 *     // If this throws a PostgresError, it will be handled
 *     return await db.select().from('users').where('id', id);
 *   }
 * }
 * ```
 */
export const OnError = (handler: ErrorHandler): ClassDecorator => {
  return <TFunction extends Function>(target: TFunction): TFunction => {
    for (const propertyName of Reflect.ownKeys(target.prototype).filter(prop => prop !== 'constructor')) {
      const desc = Object.getOwnPropertyDescriptor(target.prototype, propertyName);
      if (desc) {
        const isMethod = desc.value instanceof Function || desc.get instanceof Function || desc.set instanceof Function;
        if (isMethod) {
          Object.defineProperty(target.prototype, propertyName, generateDescriptor(desc, handler));
        }
      }
    }
    return target;
  };
};
