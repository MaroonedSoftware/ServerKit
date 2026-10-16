import { ExportResult, ExportResultCode } from '@opentelemetry/core';

/**
 * Runs an OTel exporter's callback-style `export` as a promise that rejects on failure.
 *
 * @param run - Calls the exporter with the given callback.
 */
export const exportAsPromise = (run: (done: (result: ExportResult) => void) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    run(result => {
      if (result.code === ExportResultCode.SUCCESS) {
        resolve();
      } else {
        reject(result.error ?? new Error('OTLP export failed'));
      }
    });
  });
