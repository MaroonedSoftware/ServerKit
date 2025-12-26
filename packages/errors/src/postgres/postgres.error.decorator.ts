import { PostgresErrorHandler } from './postgres.error.handler.js';
import { OnError } from '../on.error.decorator.js';

export const OnPostgresError = () => OnError(PostgresErrorHandler);
