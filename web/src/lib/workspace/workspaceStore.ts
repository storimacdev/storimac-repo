import { getDb } from "@/lib/firebaseAdmin";
import {
  TIER_LIMITS,
  type Invite,
  type InviteStatus,
  type MemberRole,
  type Membership,
  type Tier,
  type Workspace,
  type WorkspaceType,
} from "./types";

/**
 * Workspace provisioning, membership, and tier enforcement — GitHub issue
 * #88. "First user becomes Workspace Admin", "Admin can promote/demote
 * users", and the Free/Premium limits are all enforced here, at the store
 * layer, not left to callers to remember.
 */

export class WorkspaceAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAuthorizationError";
  }
}

export class TierLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierLimitError";
  }
}

function workspacesCollection() {
  return getDb().collection("workspaces");
}

function membersCollection(workspaceId: string) {
  return workspacesCollection().doc(workspaceId).collection("members");
}

function invitesCollection(workspaceId: string) {
  return workspacesCollection().doc(workspaceId).collection("invites");
}

export async function getWorkspace(workspaceId: string): Promise<Workspace | null> {
  const snap = await workspacesCollection().doc(workspaceId).get();
  return snap.exists ? (snap.data() as Workspace) : null;
}

export async function getMembership(workspaceId: string, uid: string): Promise<Membership | null> {
  const snap = await membersCollection(workspaceId).doc(uid).get();
  return snap.exists ? (snap.data() as Membership) : null;
}

export async function listMembers(workspaceId: string): Promise<Membership[]> {
  const snap = await membersCollection(workspaceId).get();
  return snap.docs.map((d) => d.data() as Membership);
}

/** All workspaces `uid` belongs to, via a collectionGroup query across every workspace's members subcollection. */
export async function listWorkspacesForUser(uid: string): Promise<Workspace[]> {
  const memberSnap = await getDb().collectionGroup("members").where("uid", "==", uid).get();
  const workspaceIds = memberSnap.docs.map((d) => d.ref.parent.parent!.id);
  if (workspaceIds.length === 0) return [];

  const workspaces = await Promise.all(workspaceIds.map((id) => getWorkspace(id)));
  return workspaces.filter((w): w is Workspace => w !== null);
}

async function countWorkspacesOwnedBy(ownerUid: string): Promise<number> {
  const snap = await workspacesCollection().where("ownerUid", "==", ownerUid).get();
  return snap.size;
}

/**
 * Creates a workspace and makes the creator its first member with role
 * Admin — issue #88: "First user automatically becomes Admin." Enforces
 * the Free-tier "1 Story Workspace" limit per owner before creating.
 */
export async function createWorkspace(
  ownerUid: string,
  ownerEmail: string,
  name: string,
  type: WorkspaceType = "StoryWorkspace",
  tier: Tier = "free"
): Promise<Workspace> {
  const limits = TIER_LIMITS[tier];
  if (limits.maxWorkspacesPerOwner !== null) {
    const existing = await countWorkspacesOwnedBy(ownerUid);
    if (existing >= limits.maxWorkspacesPerOwner) {
      throw new TierLimitError(
        `Free tier allows only ${limits.maxWorkspacesPerOwner} workspace per owner; this author already has ${existing}.`
      );
    }
  }

  const db = getDb();
  const now = new Date().toISOString();
  const ref = workspacesCollection().doc();
  const workspace: Workspace = { id: ref.id, type, name, tier, ownerUid, createdAt: now, updatedAt: now };
  const membership: Membership = { workspaceId: ref.id, uid: ownerUid, email: ownerEmail, role: "Admin", joinedAt: now };

  await db.runTransaction(async (tx) => {
    tx.set(ref, workspace);
    tx.set(membersCollection(ref.id).doc(ownerUid), membership);
  });

  return workspace;
}

export async function renameWorkspace(workspaceId: string, actingUid: string, name: string): Promise<Workspace> {
  await requireRole(workspaceId, actingUid, "Admin");
  const updatedAt = new Date().toISOString();
  await workspacesCollection().doc(workspaceId).update({ name, updatedAt });
  return { ...(await getWorkspace(workspaceId))!, name, updatedAt };
}

export async function deleteWorkspace(workspaceId: string, actingUid: string): Promise<void> {
  await requireRole(workspaceId, actingUid, "Admin");
  await getDb().recursiveDelete(workspacesCollection().doc(workspaceId));
}

/** Throws WorkspaceAuthorizationError unless `uid` holds `role` (or a strictly higher role, for Admin checks). */
export async function requireRole(workspaceId: string, uid: string, role: MemberRole): Promise<Membership> {
  const membership = await getMembership(workspaceId, uid);
  if (!membership) {
    throw new WorkspaceAuthorizationError(`User is not a member of workspace "${workspaceId}".`);
  }
  if (role === "Admin" && membership.role !== "Admin") {
    throw new WorkspaceAuthorizationError(`Only an Admin can perform this action; user is "${membership.role}".`);
  }
  return membership;
}

/**
 * Adds a member directly (used by acceptInvite; not exposed as a raw
 * "add anyone" API since membership should come through the invite flow).
 * Enforces the tier's member-count limit.
 */
async function addMember(workspaceId: string, uid: string, email: string, role: MemberRole): Promise<Membership> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);

  const limits = TIER_LIMITS[workspace.tier];
  if (limits.maxMembers !== null) {
    const current = await listMembers(workspaceId);
    if (!current.some((m) => m.uid === uid) && current.length >= limits.maxMembers) {
      throw new TierLimitError(
        `${workspace.tier} tier allows only ${limits.maxMembers} member(s); workspace "${workspaceId}" already has ${current.length}.`
      );
    }
  }

  const membership: Membership = { workspaceId, uid, email, role, joinedAt: new Date().toISOString() };
  await membersCollection(workspaceId).doc(uid).set(membership);
  return membership;
}

/** "Admin can promote/demote users." */
export async function setMemberRole(
  workspaceId: string,
  actingUid: string,
  targetUid: string,
  newRole: MemberRole
): Promise<Membership> {
  await requireRole(workspaceId, actingUid, "Admin");

  if (newRole !== "Admin") {
    const workspace = await getWorkspace(workspaceId);
    const members = await listMembers(workspaceId);
    const admins = members.filter((m) => m.role === "Admin");
    const targetIsOnlyAdmin = admins.length === 1 && admins[0].uid === targetUid;
    if (targetIsOnlyAdmin) {
      throw new WorkspaceAuthorizationError(
        `Cannot demote the only Admin of workspace "${workspace?.name ?? workspaceId}" - promote another member first.`
      );
    }
  }

  const ref = membersCollection(workspaceId).doc(targetUid);
  await ref.update({ role: newRole });
  const updated = await ref.get();
  return updated.data() as Membership;
}

/** "Invite teammates (Premium)" - Free tier can't invite at all (1 user only), enforced here, not just cosmetically in the UI. */
export async function createInvite(
  workspaceId: string,
  actingUid: string,
  email: string,
  role: MemberRole = "Member"
): Promise<Invite> {
  await requireRole(workspaceId, actingUid, "Admin");

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);

  const limits = TIER_LIMITS[workspace.tier];
  if (limits.maxMembers !== null) {
    const [members, pendingInvites] = await Promise.all([listMembers(workspaceId), listInvites(workspaceId, "pending")]);
    if (members.length + pendingInvites.length >= limits.maxMembers) {
      throw new TierLimitError(
        `${workspace.tier} tier allows only ${limits.maxMembers} member(s) - upgrade to Premium to invite teammates.`
      );
    }
  }

  const ref = invitesCollection(workspaceId).doc();
  const invite: Invite = {
    id: ref.id,
    workspaceId,
    email,
    role,
    invitedByUid: actingUid,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await ref.set(invite);
  return invite;
}

export async function listInvites(workspaceId: string, status?: InviteStatus): Promise<Invite[]> {
  let query = invitesCollection(workspaceId) as FirebaseFirestore.Query;
  if (status) query = query.where("status", "==", status);
  const snap = await query.get();
  return snap.docs.map((d) => d.data() as Invite);
}

export async function revokeInvite(workspaceId: string, actingUid: string, inviteId: string): Promise<void> {
  await requireRole(workspaceId, actingUid, "Admin");
  await invitesCollection(workspaceId).doc(inviteId).update({ status: "revoked" satisfies InviteStatus });
}

/** The invited user accepts - becomes a Member (or the invite's specified role), re-checking tier limits at accept time. */
export async function acceptInvite(workspaceId: string, inviteId: string, uid: string, email: string): Promise<Membership> {
  const ref = invitesCollection(workspaceId).doc(inviteId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Invite "${inviteId}" not found.`);
  const invite = snap.data() as Invite;

  if (invite.status !== "pending") {
    throw new WorkspaceAuthorizationError(`Invite "${inviteId}" is ${invite.status}, not pending.`);
  }
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new WorkspaceAuthorizationError(`Invite "${inviteId}" was issued to a different email address.`);
  }

  const membership = await addMember(workspaceId, uid, email, invite.role);
  await ref.update({ status: "accepted" satisfies InviteStatus });
  return membership;
}
