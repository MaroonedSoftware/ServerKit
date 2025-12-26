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
      descriptor.get = () => {
        try {
          return getter.apply(this);
        } catch (error) {
          handler(error as Error);
        }
      };
    }

    if (setter) {
      descriptor.set = (v: unknown) => {
        try {
          return setter.apply(this, [v]);
        } catch (error) {
          handler(error as Error);
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
        });
      }

      return result;
    } catch (error) {
      handler(error as Error);
    }
  };

  return descriptor;
};

/**
 * Class decorator that automatically wraps all methods, getters, and setters in a class
 * with error handling. When any decorated method throws an error (synchronously or asynchronously),
 * the provided error handler is called.
 *
 * The decorator:
 * - Wraps all methods (including async methods) with try-catch
 * - Wraps getters and setters with try-catch
 * - Does not wrap the constructor
 * - Does not wrap non-method properties
 *
 * @param handler - The error handler function to call when an error is caught.
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
