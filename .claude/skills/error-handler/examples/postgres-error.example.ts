import { OnPostgresError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';

/**
 * User Repository with PostgreSQL error handling
 *
 * All PostgreSQL errors are automatically mapped to appropriate HTTP errors:
 * - Unique constraint violation (23505) → 409 Conflict
 * - Foreign key violation (23503) → 400 Bad Request
 * - Not null violation (23502) → 400 Bad Request
 * - Check violation (23514) → 400 Bad Request
 * - Other errors → 500 Internal Server Error
 */
@OnPostgresError()
@Injectable()
export class UserRepository {
  constructor(private readonly db: any) {}

  async create(data: { name: string; email: string }) {
    // If email already exists (unique constraint), throws 409 Conflict
    // If data violates not null constraint, throws 400 Bad Request
    return await this.db.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
      [data.name, data.email]
    );
  }

  async update(id: string, data: { name?: string; email?: string }) {
    // If new email already exists (unique constraint), throws 409 Conflict
    // If data violates constraints, throws 400 Bad Request
    return await this.db.query(
      'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *',
      [data.name, data.email, id]
    );
  }

  async addUserRole(userId: string, roleId: string) {
    // If userId or roleId doesn't exist (foreign key), throws 400 Bad Request
    // If combination already exists (unique constraint), throws 409 Conflict
    return await this.db.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) RETURNING *',
      [userId, roleId]
    );
  }

  async findById(id: string) {
    // No error mapping needed for SELECT queries
    const result = await this.db.query('SELECT * FROM users WHERE id = $1', [
      id
    ]);
    return result.rows[0];
  }

  async delete(id: string) {
    // If user has related records (foreign key constraint), throws 400 Bad Request
    await this.db.query('DELETE FROM users WHERE id = $1', [id]);
  }
}

// Error mapping examples:
//
// 1. Unique constraint violation:
//    Database error: duplicate key value violates unique constraint "users_email_key"
//    HTTP error: 409 Conflict with details: { constraint: 'users_email_key' }
//
// 2. Foreign key violation:
//    Database error: insert or update on table "user_roles" violates foreign key constraint
//    HTTP error: 400 Bad Request with details about the constraint
//
// 3. Not null violation:
//    Database error: null value in column "email" violates not-null constraint
//    HTTP error: 400 Bad Request with details: { column: 'email' }
//
// 4. Check constraint violation:
//    Database error: new row for relation "users" violates check constraint "users_age_check"
//    HTTP error: 400 Bad Request with details: { constraint: 'users_age_check' }

// Note: The @OnPostgresError decorator automatically handles all these cases.
// You don't need to add any try/catch blocks or manual error handling.
