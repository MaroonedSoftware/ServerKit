import { Logger } from './logger.js';

/**
 * Console-based implementation of the Logger interface.
 * Logs messages to the browser or Node.js console using the standard console API.
 */
export class ConsoleLogger implements Logger {
  /**
   * Creates a new ConsoleLogger instance.
   * @param _console - The console implementation to use for logging. Defaults to the global console object.
   */
  constructor(private readonly _console: Console = console) {}

  /**
   * Internal method to log messages at a specific level.
   * @param level - The log level ('error', 'warn', 'info', 'debug', or 'trace').
   * @param message - The message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  private log(level: 'error' | 'warn' | 'info' | 'debug' | 'trace', message: unknown, optionalParams: unknown[]) {
    if (optionalParams.length > 0) {
      this._console[level](message, optionalParams);
    } else {
      this._console[level](message);
    }
  }

  /**
   * Logs an error message to the console.
   * @param message - The error message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.log('error', message, optionalParams);
  }

  /**
   * Logs a warning message to the console.
   * @param message - The warning message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.log('warn', message, optionalParams);
  }

  /**
   * Logs an informational message to the console.
   * @param message - The informational message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  info(message: unknown, ...optionalParams: unknown[]): void {
    this.log('info', message, optionalParams);
  }

  /**
   * Logs a debug message to the console.
   * @param message - The debug message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.log('debug', message, optionalParams);
  }

  /**
   * Logs a trace message to the console.
   * @param message - The trace message to log.
   * @param optionalParams - Additional parameters to include in the log output.
   */
  trace(message: unknown, ...optionalParams: unknown[]): void {
    this.log('trace', message, optionalParams);
  }
}
