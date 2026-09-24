/**
 * Roles, ordered. A check is "at least this much", never an equality test,
 * because every place that asks is really asking whether someone is allowed to
 * do a thing, and an owner is allowed to do anything an admin can.
 */
export const ORG_ROLES = /** @type {const} */ (["member", "admin", "owner"]);
export const TEAM_ROLES = /** @type {const} */ (["member", "lead"]);

const ORG_RANK = new Map(ORG_ROLES.map((r, i) => [r, i]));
const TEAM_RANK = new Map(TEAM_ROLES.map((r, i) => [r, i]));

/** Is `role` at least `needed`? Unknown roles are never enough. */
export function atLeast(role, needed) {
  const a = ORG_RANK.get(role);
  const b = ORG_RANK.get(needed);
  return a !== undefined && b !== undefined && a >= b;
}

export function teamAtLeast(role, needed) {
  const a = TEAM_RANK.get(role);
  const b = TEAM_RANK.get(needed);
  return a !== undefined && b !== undefined && a >= b;
}

export function isOrgRole(value) {
  return ORG_RANK.has(value);
}

export function isTeamRole(value) {
  return TEAM_RANK.has(value);
}
