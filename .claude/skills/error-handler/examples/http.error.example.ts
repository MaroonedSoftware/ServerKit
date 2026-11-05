import { OnError, ServerkitError, httpError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';

// Domain failures are ServerkitError subclasses, so the mapping below can use instanceof.
export class EmailInvalidError extends ServerkitError {}
export class UserNotFoundError extends ServerkitError {}

/**
 * Every method and accessor declared on this class is wrapped, sync and async alike. Inherited and
 * static methods are not, and neither is the constructor.
 *
 * The handler either throws a replacement, which reaches the caller, or returns, in which case the
 * original error is re-thrown. There is no way to swallow an error from here.
 */
@OnError(error => {
  if (error instanceof EmailInvalidError) {
    throw httpError(400).withDetails({ email: error.message }).withCause(error);
  }

  if (error instanceof UserNotFoundError) {
    throw httpError(404).withDetails({ user: error.message }).withCause(error);
  }

  // Returning re-throws the original. A plain Error then renders as a generic 500 with no details.
})
@Injectable()
export class UserService {
  async createUser(data: { name: string; email: string }) {
    if (!data.email.includes('@')) {
      throw new EmailInvalidError('Invalid email format');
    }

    return { id: 'not.implemented', ...data };
  }

  async getUserById(id: string): Promise<{ id: string; name: string }> {
    throw new UserNotFoundError(`User ${id} not found`);
  }
}

// The decorator replaces the try/catch each method would otherwise need. Throw domain errors, and
// let this one place decide what they look like over HTTP.
