import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { isOrgRole } from "./roles.js";
import { addMember } from "./members.js";

const DEFAULT_TTL_HOURS = 14 * 24;

/** The token is shown once, at creation. Only its hash is ever stored. */
function mintToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Invite an address to an organization.
 *
 * Re-inviting the same address replaces the pending invitation rather than
 * adding a second one, so the newest role is the one that can be accepted and
 * an older link cannot grant something that was since revised.
 */
export async function inviteToOrg(sql, { orgId, email, role = "member", invitedBy, ttlHours }) {
  if (!isOrgRole(role)) throw new Error(`unknown role: ${role}`);
  if (!email) throw new Error("email is required");
  const { token, hash } = mintToken();
  const hours = ttlHours ?? DEFAULT_TTL_HOURS;

  const invite = await sql.begin(async (tx) => {
    await tx`
      update org_invites set revoked_at = now()
      where org_id = ${orgId} and lower(email) = lower(${email})
        and accepted_at is null and revoked_at is null`;
    const [row] = await tx`
      insert into org_invites (org_id, email, role, token_hash, invited_by, expires_at)
      values (${orgId}, ${email}, ${role}, ${hash}, ${invitedBy ?? null},
              now() + ${`${hours} hours`}::interval)
      returning *`;
    return row;
  });

  // The only time the caller can see it: it has to reach the invitee now.
  return { invite, token };
}

export async function listInvites(sql, orgId, { pendingOnly = true } = {}) {
  return pendingOnly
    ? sql`select * from org_invites
          where org_id = ${orgId} and accepted_at is null and revoked_at is null
            and expires_at > now()
          order by created_at desc`
    : sql`select * from org_invites where org_id = ${orgId} order by created_at desc`;
}

export async function revokeInvite(sql, id) {
  const [row] = await sql`
    update org_invites set revoked_at = now()
    where id = ${id} and accepted_at is null and revoked_at is null
    returning id`;
  return Boolean(row);
}

/** Look up a live invitation by its token. Expired, spent and revoked all miss. */
export async function findInvite(sql, token) {
  if (!token) return null;
  const [row] = await sql`
    select * from org_invites
    where token_hash = ${hashToken(token)}
      and accepted_at is null and revoked_at is null and expires_at > now()`;
  return row ?? null;
}

/**
 * Accept an invitation.
 *
 * The row is claimed with a conditional update inside the transaction, so two
 * simultaneous accepts of the same link cannot both succeed: the second finds
 * nothing to claim and is told the invitation is no longer valid.
 */
export async function acceptInvite(sql, { token, userId }) {
  if (!userId) throw new Error("userId is required");
  const hash = hashToken(token ?? "");
  return sql.begin(async (tx) => {
    const [invite] = await tx`
      update org_invites set accepted_at = now(), accepted_by = ${userId}
      where token_hash = ${hash}
        and accepted_at is null and revoked_at is null and expires_at > now()
      returning *`;
    if (!invite) {
      const err = new Error("this invitation is no longer valid");
      err.code = "INVALID_INVITE";
      err.status = 410;
      throw err;
    }
    const member = await addMember(tx, {
      orgId: invite.org_id,
      userId,
      role: invite.role,
    });
    return { invite, member };
  });
}

/** Constant-time compare, for callers checking a token themselves. */
export function tokenMatches(token, storedHash) {
  const a = Buffer.from(hashToken(token ?? ""), "hex");
  const b = Buffer.from(String(storedHash ?? ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
