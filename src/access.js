import { atLeast } from "./roles.js";
import { getMembership } from "./members.js";

/**
 * Can this user act in this organization at this level?
 *
 * The one question worth asking, and the only one that should decide anything.
 * Returns the membership when allowed and null when not, so a caller can use
 * the role it already looked up instead of asking twice.
 */
export async function can(sql, { orgId, userId, role = "member" }) {
  if (!orgId || !userId) return null;
  const membership = await getMembership(sql, { orgId, userId });
  if (!membership) return null;
  return atLeast(membership.role, role) ? membership : null;
}

/** The same check, as a guard: it throws rather than returning null. */
export async function requireRole(sql, { orgId, userId, role = "member" }) {
  const membership = await can(sql, { orgId, userId, role });
  if (!membership) {
    const err = new Error(`requires ${role} in this organization`);
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }
  return membership;
}

/**
 * Everything a request handler needs about one user in one org, in a round trip:
 * their org role and the teams they sit on.
 */
export async function contextFor(sql, { orgId, userId }) {
  const membership = await getMembership(sql, { orgId, userId });
  if (!membership) return null;
  const teams = await sql`
    select t.id, t.slug, t.name, tm.role
    from teams t
    join team_members tm on tm.team_id = t.id
    where t.org_id = ${orgId} and tm.user_id = ${userId}
    order by t.name`;
  return { orgId, userId, role: membership.role, teams };
}
