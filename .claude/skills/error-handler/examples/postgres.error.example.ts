import { OnPostgresError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';

// Stands in for your database client, e.g. Kysely<DB> from @maroonedsoftware/kysely.
@Injectable()
export abstract class Database {
  abstract query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * @OnPostgresError() is @OnError(PostgresErrorHandler). It maps an error whose `code` is a
 * five-character SQLSTATE to an HttpError with the original as its cause:
 *
 * - 23505 (unique violation): 409
 * - 23503 (foreign key violation): 409
 * - 23502 (not null), 23514 (check), 22000, 22003, 22004, 22023, 22P02 (bad data): 400
 * - 40000, 40001, 40002 (rollback), 40P01 (deadlock): 500, with an internal message for the logs
 * - any other SQLSTATE: 500
 *
 * An error without a SQLSTATE code (e.g. ENOENT) is re-thrown unchanged. The mapped error has no
 * details, so the client sees only the status and its standard message. The constraint name stays
 * on the cause.
 */
@OnPostgresError()
@Injectable()
export class UserRepository {
  constructor(private readonly db: Database) {}

  async create(data: { name: string; email: string }) {
    // A duplicate email raises 23505, which becomes 409 Conflict.
    return await this.db.query('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *', [data.name, data.email]);
  }

  async addUserRole(userId: string, roleId: string) {
    // A missing user or role raises 23503, which becomes 409 Conflict.
    return await this.db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) RETURNING *', [userId, roleId]);
  }

  async delete(id: string) {
    // A row still referenced elsewhere raises 23503, which also becomes 409 Conflict.
    await this.db.query('DELETE FROM users WHERE id = $1', [id]);
  }
}
