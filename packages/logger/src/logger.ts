/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';

/**
 * Interface for logging functionality with different log levels.
 * Provides methods for logging messages at various severity levels.
 */
export interface Logger {
  /**
   * Logs an error message.
   * @param message - The error message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  error(message: unknown, ...optionalParams: unknown[]): void;

  /**
   * Logs a warning message.
   * @param message - The warning message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  warn(message: unknown, ...optionalParams: unknown[]): void;

  /**
   * Logs an informational message.
   * @param message - The informational message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  info(message: unknown, ...optionalParams: unknown[]): void;

  /**
   * Logs a debug message.
   * @param message - The debug message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  debug(message: unknown, ...optionalParams: unknown[]): void;

  /**
   * Logs a trace message.
   * @param message - The trace message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  trace(message: unknown, ...optionalParams: unknown[]): void;
}

/**
 * Abstract base class for logger implementations.
 * This class is marked as injectable for use with dependency injection containers.
 * Concrete implementations should extend this class and provide the actual logging behavior.
 * @inheritDoc Logger
 */
@Injectable()
export abstract class Logger implements Logger {}
