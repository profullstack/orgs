/**
 * The schema.
 *
 * Deliberately missing: a users table. This package never owns user identity,
 * because the host already does and its table may be named anything, live in
 * another schema, or not be in this database at all. So `user_id` is a bare
 * uuid with an index and no foreign key, and removing a user is the host's job.
 * That is the one coupling worth refusing; everything else here is ordinary.
 */
export const SCHEMA_SQL = `
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  -- Globally unique: it appears in URLs.
  slug text not null unique,
  name text not null,
  -- Personal orgs are made for a single user on their way in, and are hidden
  -- from anything that lists "your organizations" for a person to choose.
  is_personal boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('member', 'admin', 'owner')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user on org_members(user_id);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Unique within its organization, not globally: two companies may both have
  -- a team called "design".
  slug text not null,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('member', 'lead')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user on team_members(user_id);

create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('member', 'admin', 'owner')),
  -- Only the hash is stored, so a leaked database does not hand out memberships.
  token_hash text not null unique,
  invited_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);
create index if not exists org_invites_org on org_invites(org_id, created_at desc);
-- One live invitation per address per org. Re-inviting replaces rather than
-- stacks, so accepting the oldest link cannot grant a role that was revised.
create unique index if not exists org_invites_pending
  on org_invites(org_id, lower(email))
  where accepted_at is null and revoked_at is null;
`;

/** Apply the schema. Safe to run repeatedly. */
export async function migrate(sql) {
  await sql.unsafe(SCHEMA_SQL);
}
