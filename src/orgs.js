import { uniqueSlug } from "./slug.js";

/**
 * Create an organization and make its creator the owner.
 *
 * Both rows go in one transaction. An organization with no owner cannot be
 * administered by anyone, including the person who just made it, and it cannot
 * be deleted through the API either, so a half-finished create is worse than
 * no create at all.
 */
export async function createOrg(sql, { name, slug, userId, isPersonal = false }) {
  if (!name) throw new Error("name is required");
  if (!userId) throw new Error("userId is required");

  const wanted = await uniqueSlug(slug || name, async (candidate) => {
    const [row] = await sql`select 1 from organizations where slug = ${candidate}`;
    return Boolean(row);
  });

  return sql.begin(async (tx) => {
    const [org] = await tx`
      insert into organizations (slug, name, is_personal, created_by)
      values (${wanted}, ${name}, ${isPersonal}, ${userId})
      returning *`;
    await tx`
      insert into org_members (org_id, user_id, role)
      values (${org.id}, ${userId}, 'owner')
      on conflict (org_id, user_id) do update set role = 'owner'`;
    return org;
  });
}

export async function getOrg(sql, id) {
  const [row] = await sql`select * from organizations where id = ${id}`;
  return row ?? null;
}

export async function getOrgBySlug(sql, slug) {
  const [row] = await sql`select * from organizations where slug = ${slug}`;
  return row ?? null;
}

/** Every org a user belongs to, with the role they hold in each. */
export async function listOrgsForUser(sql, userId, { includePersonal = true } = {}) {
  return sql`
    select o.*, m.role
    from organizations o
    join org_members m on m.org_id = o.id
    where m.user_id = ${userId}
      ${includePersonal ? sql`` : sql`and o.is_personal = false`}
    order by o.is_personal desc, o.name`;
}

export async function updateOrg(sql, id, { name, slug }) {
  const [row] = await sql`
    update organizations set
      name = coalesce(${name ?? null}, name),
      slug = coalesce(${slug ?? null}, slug),
      updated_at = now()
    where id = ${id}
    returning *`;
  return row ?? null;
}

export async function deleteOrg(sql, id) {
  const [row] = await sql`delete from organizations where id = ${id} returning id`;
  return Boolean(row);
}

/**
 * The organization a user gets by simply existing.
 *
 * Every app that adds tenancy later has the same problem: work already exists
 * and belongs to a person, not a company. Giving each user one personal org
 * means ownership is uniform from day one and nothing has to special-case a
 * null org id.
 */
export async function ensurePersonalOrg(sql, { userId, name, slug }) {
  const [existing] = await sql`
    select o.* from organizations o
    join org_members m on m.org_id = o.id
    where m.user_id = ${userId} and o.is_personal = true
    order by o.created_at
    limit 1`;
  if (existing) return existing;
  return createOrg(sql, {
    name: name || "Personal",
    slug: slug || name || "personal",
    userId,
    isPersonal: true,
  });
}
