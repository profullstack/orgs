import { isOrgRole } from "./roles.js";

export async function addMember(sql, { orgId, userId, role = "member" }) {
  if (!isOrgRole(role)) throw new Error(`unknown role: ${role}`);
  const [row] = await sql`
    insert into org_members (org_id, user_id, role)
    values (${orgId}, ${userId}, ${role})
    on conflict (org_id, user_id) do update set role = excluded.role
    returning *`;
  return row;
}

export async function getMembership(sql, { orgId, userId }) {
  const [row] = await sql`
    select * from org_members where org_id = ${orgId} and user_id = ${userId}`;
  return row ?? null;
}

export async function listMembers(sql, orgId) {
  return sql`
    select * from org_members where org_id = ${orgId}
    order by case role when 'owner' then 0 when 'admin' then 1 else 2 end, created_at`;
}

export async function countOwners(sql, orgId) {
  const [row] = await sql`
    select count(*)::int as n from org_members where org_id = ${orgId} and role = 'owner'`;
  return row?.n ?? 0;
}

/**
 * Change someone's role, refusing to remove the last owner.
 *
 * An org whose last owner demotes themselves cannot be administered by anyone
 * again: nobody can invite, nobody can promote, and nobody can delete it. It is
 * an easy mistake to make from a UI, so it is refused here rather than in each
 * caller, and the same guard covers removal below.
 */
export async function setRole(sql, { orgId, userId, role }) {
  if (!isOrgRole(role)) throw new Error(`unknown role: ${role}`);
  return sql.begin(async (tx) => {
    const [current] = await tx`
      select * from org_members where org_id = ${orgId} and user_id = ${userId} for update`;
    if (!current) return null;
    if (current.role === "owner" && role !== "owner") {
      const [{ n }] = await tx`
        select count(*)::int as n from org_members
        where org_id = ${orgId} and role = 'owner'`;
      if (n <= 1) throw new Error("an organization must keep at least one owner");
    }
    const [row] = await tx`
      update org_members set role = ${role}
      where org_id = ${orgId} and user_id = ${userId}
      returning *`;
    return row ?? null;
  });
}

export async function removeMember(sql, { orgId, userId }) {
  return sql.begin(async (tx) => {
    const [current] = await tx`
      select * from org_members where org_id = ${orgId} and user_id = ${userId} for update`;
    if (!current) return false;
    if (current.role === "owner") {
      const [{ n }] = await tx`
        select count(*)::int as n from org_members
        where org_id = ${orgId} and role = 'owner'`;
      if (n <= 1) throw new Error("an organization must keep at least one owner");
    }
    // Leaving the org leaves its teams too, or the person keeps a team seat in
    // a company they are no longer part of.
    await tx`
      delete from team_members tm using teams t
      where tm.team_id = t.id and t.org_id = ${orgId} and tm.user_id = ${userId}`;
    await tx`delete from org_members where org_id = ${orgId} and user_id = ${userId}`;
    return true;
  });
}
