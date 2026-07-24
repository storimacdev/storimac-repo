/**
 * Workspace / membership / tier data model — GitHub issue #88.
 * Firestore layout: /workspaces/{workspaceId}, with members and invites as
 * subcollections (mirrors the /stories/{storyId} pattern from storyStore.ts).
 */

export type WorkspaceType = "StoryWorkspace" | "NovelWorkspace" | "WebSeriesWorkspace";

export type Tier = "free" | "premium";

export type MemberRole = "Admin" | "Member" | "Viewer";

export interface Workspace {
  id: string;
  type: WorkspaceType;
  name: string;
  tier: Tier;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  workspaceId: string;
  uid: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

export type InviteStatus = "pending" | "accepted" | "revoked";

export interface Invite {
  id: string;
  workspaceId: string;
  email: string;
  role: MemberRole;
  invitedByUid: string;
  status: InviteStatus;
  createdAt: string;
}

/** Free: 1 user only, 1 workspace, 1 canvas. Premium: multiple of each, multiple admins. */
export const TIER_LIMITS: Record<Tier, { maxMembers: number | null; maxWorkspacesPerOwner: number | null; maxCanvasesPerWorkspace: number | null }> = {
  free: { maxMembers: 1, maxWorkspacesPerOwner: 1, maxCanvasesPerWorkspace: 1 },
  premium: { maxMembers: null, maxWorkspacesPerOwner: null, maxCanvasesPerWorkspace: null },
};
