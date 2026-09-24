import { isTeamRole } from "./roles.js";
import { uniqueSlug } from "./slug.js";

export async function createTeam(sql, { orgId, name, slug, userId }) {
  if (!orgId) throw new Error("orgId is required");
  if (!name) throw new Error("name is required");

  const wanted = await uniqueSlug(slug || name, async (candidate) => {
    const [row] = await sql`
      select 1 from teams where org_id = ${orgId} and slug = ${candidate}`;
    return Boolean(row);
  });

  return sql.begin(async (tx) => {
    const [team] = await tx`
      insert into teams (org_id, slug, name, created_by)
      values (${orgId}, ${wanted}, ${name}, ${userId ?? null})
      returning *`;
    if (userId) {
      await tx`
        insert into team_members (team_id, user_id, role)
        values (${team.id}, ${userId}, 'lead')
        on conflict (team_id, user_id) do update set role = 'lead'`;
    }
    return team;
  });
}

export async function getTeam(sql, id) {
  const [row] = await sql`select * from teams where id = ${id}`;
  return row ?? null;
}

export async function listTeams(sql, orgId) {
  return sql`select * from teams where org_id = ${orgId} order by name`;
}

/** Only teams inside `orgId`, so a team seat elsewhere cannot leak in. */
export async function listTeamsForUser(sql, { orgId, userId }) {
  return sql`
    select t.*, tm.role
    from teams t
    join team_members tm on tm.team_id = t.id
    where t.org_id = ${orgId} and tm.user_id = ${userId}
    order by t.name`;
}

export async function updateTeam(sql, id, { name, slug }) {
  const [row] = await sql`
    update teams set
      name = coalesce(${name ?? null}, name),
      slug = coalesce(${slug ?? null}, slug),
      updated_at = now()
    where id = ${id}
    returning *`;
  return row ?? null;
}

export async function deleteTeam(sql, id) {
  const [row] = await sql`delete from teams where id = ${id} returning id`;
  return Boolean(row);
}

/**
 * Put someone on a team.
 *
 * Refused unless they are already in the organization. A team seat is a subset
 * of org membership, never a way around it, so this cannot be used to hand
 * someone access to a company they were never admitted to.
 */
export async function addTeamMember(sql, { teamId, userId, role = "member" }) {
  if (!isTeamRole(role)) throw new Error(`unknown team role: ${role}`);
  const [ok] = await sql`
    select 1 from teams t
    join org_members m on m.org_id = t.org_id
    where t.id = ${teamId} and m.user_id = ${userId}`;
  if (!ok) throw new Error("user is not a member of the team's organization");

  const [row] = await sql`
    insert into team_members (team_id, user_id, role)
    values (${teamId}, ${userId}, ${role})
    on conflict (team_id, user_id) do update set role = excluded.role
    returning *`;
  return row;
}

export async function removeTeamMember(sql, { teamId, userId }) {
  const [row] = await sql`
    delete from team_members where team_id = ${teamId} and user_id = ${userId}
    returning team_id`;
  return Boolean(row);
}

export async function listTeamMembers(sql, teamId) {
  return sql`
    select * from team_members where team_id = ${teamId}
    order by case role when 'lead' then 0 else 1 end, created_at`;
}
