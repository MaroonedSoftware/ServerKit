import { OnError, httpError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';

/**
 * User Service with HTTP error handling
 *
 * All methods are wrapped with error handling that converts errors to HTTP errors.
 */
@OnError(error => {
  // Handle specific error types
  if (error.name === 'ValidationError') {
    throw httpError(400)
      .withDetails({ message: error.message })
      .withCause(error);
  }

  if (error.name === 'NotFoundError') {
    throw httpError(404)
      .withDetails({ message: 'Resource not found' })
      .withCause(error);
  }

  if (error.name === 'UnauthorizedError') {
    throw httpError(401)
      .withDetails({ message: 'Unauthorized' })
      .withCause(error);
  }

  // Default to 500 for unknown errors
  throw httpError(500)
    .withDetails({ message: 'Internal server error' })
    .withCause(error);
})
@Injectable()
export class UserService {
  async createUser(data: { name: string; email: string }) {
    // If any error is thrown, it will be converted to an HTTP error
    // based on the error handler above

    if (!data.email.includes('@')) {
      const error = new Error('Invalid email format');
      error.name = 'ValidationError';
      throw error;
    }

    // Create user logic...
    return { id: '123', ...data };
  }

  async getUserById(id: string) {
    // If user not found, throw NotFoundError
    // The decorator will convert it to 404 HTTP error

    const user = null; // Simulate not found

    if (!user) {
      const error = new Error(`User ${id} not found`);
      error.name = 'NotFoundError';
      throw error;
    }

    return user;
  }

  async updateUser(id: string, data: { name?: string; email?: string }) {
    // Any unexpected errors will be converted to 500

    if (data.email && !data.email.includes('@')) {
      const error = new Error('Invalid email format');
      error.name = 'ValidationError';
      throw error;
    }

    // Update user logic...
    return { id, ...data };
  }

  async deleteUser(id: string) {
    // Check authorization
    const authorized = false; // Simulate unauthorized

    if (!authorized) {
      const error = new Error('Not authorized to delete users');
      error.name = 'UnauthorizedError';
      throw error;
    }

    // Delete user logic...
  }
}

// Note: The @OnError decorator wraps ALL methods in the class.
// You don't need to add try/catch blocks in each method.
// Just throw domain errors and let the decorator convert them to HTTP errors.
