/**
 * Minimal structured observability helpers for Cloud Logging.
 * Use consistent event names so log-based metrics can be built in GCP Console.
 */

import { logger } from "firebase-functions";

export type ObservabilityEvent =
  | "ingest.accepted"
  | "ingest.deduplicated"
  | "ingest.quota_exceeded"
  | "ingest.job_enqueued"
  | "ingest.job_done"
  | "ingest.job_failed"
  | "autoscan.shard_complete"
  | "purge.complete";

export function observe(
  event: ObservabilityEvent,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  logger.info(event, { event, ...fields });
}
