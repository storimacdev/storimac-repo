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
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}
