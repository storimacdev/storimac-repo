import { NextResponse } from "next/server";
import { UnauthenticatedError } from "./session";
import { WorkspaceAuthorizationError, TierLimitError } from "./workspace/workspaceStore";
import { StoryAccessError } from "./canonEngine/storyStore";

/** Maps our domain error classes to HTTP status codes consistently across API routes. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof WorkspaceAuthorizationError || err instanceof StoryAccessError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof TierLimitError) {
    return NextResponse.json({ error: err.message }, { status: 402 });
  }
  console.error("Unhandled API error:", err);
  // TEMPORARY DIAGNOSTIC (remove once the live "Internal server error." /
  // character-chat 500 is root-caused): surface the real error name/message
  // in the response instead of a generic string, since no server-log
  // access is available to the team debugging this. Revert to the plain
  // "Internal server error." message once resolved.
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return NextResponse.json({ error: `Internal server error. [DEBUG] ${detail}` }, { status: 500 });
}
