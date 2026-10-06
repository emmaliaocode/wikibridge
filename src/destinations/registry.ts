import { ConfluenceDestination } from "./confluence/confluence-destination";
import type { ConfluenceCreds } from "./confluence/confluence-write-api";
import type { ConfluenceDestinationParams } from "./confluence/confluence-destination";

// Confluence needs creds + per-run params, so it isn't constructed via a
// generic getDestination(id) factory like the other destinations might be.
// The orchestrator (Task 48) calls this builder explicitly when the import
// request comes in.
export function buildConfluenceDestination(
  creds: ConfluenceCreds,
  params: ConfluenceDestinationParams,
): ConfluenceDestination {
  return new ConfluenceDestination(creds, params);
}
