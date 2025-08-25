import type { Logger } from 'homebridge'

/**
 * Centralized error handling utilities
 */

/**
 * Logs a rejected promise with consistent formatting
 * @param log - The logger instance
 * @param operation - Description of the operation that failed
 * @param error - Optional error details
 */
export function logRejectedPromise(log: Logger, operation: string, error?: unknown): void {
  log.debug(`Promise Rejected with ${operation}.`)
  if (error) {
    log.debug(`Error details: ${error}`)
  }
}

/**
 * Creates a promise rejection handler that logs the error
 * @param log - The logger instance
 * @param operation - Description of the operation that failed
 * @returns A function that can be used with .catch()
 */
export function createPromiseRejectionHandler(log: Logger, operation: string) {
  return (error?: unknown) => {
    logRejectedPromise(log, operation, error)
  }
}