import type { Sql } from "postgres";

export type OrgRole = "member" | "admin" | "owner";
export type TeamRole = "member" | "lead";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  is_personal: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: Date;
}

export interface Team {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: TeamRole;
  created_at: Date;
}

export interface OrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token_hash: string;
  invited_by: string | null;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_by: string | null;
  revoked_at: Date | null;
}

export interface OrgContext {
  orgId: string;
  userId: string;
  role: OrgRole;
  teams: (Pick<Team, "id" | "slug" | "name"> & { role: TeamRole })[];
}

export declare const SCHEMA_SQL: string;
export declare function migrate(sql: Sql): Promise<void>;

export declare const ORG_ROLES: readonly OrgRole[];
export declare const TEAM_ROLES: readonly TeamRole[];
export declare function atLeast(role: string, needed: OrgRole): boolean;
export declare function teamAtLeast(role: string, needed: TeamRole): boolean;
export declare function isOrgRole(value: string): value is OrgRole;
export declare function isTeamRole(value: string): value is TeamRole;

export declare function slugify(value: string, fallback?: string): string;
export declare function uniqueSlug(
  base: string,
  taken: (candidate: string) => Promise<boolean>,
  limit?: number,
): Promise<string>;

export declare function createOrg(
  sql: Sql,
  opts: { name: string; slug?: string; userId: string; isPersonal?: boolean },
): Promise<Organization>;
export declare function getOrg(sql: Sql, id: string): Promise<Organization | null>;
export declare function getOrgBySlug(sql: Sql, slug: string): Promise<Organization | null>;
export declare function listOrgsForUser(
  sql: Sql,
  userId: string,
  opts?: { includePersonal?: boolean },
): Promise<(Organization & { role: OrgRole })[]>;
export declare function updateOrg(
  sql: Sql,
  id: string,
  patch: { name?: string; slug?: string },
): Promise<Organization | null>;
export declare function deleteOrg(sql: Sql, id: string): Promise<boolean>;
export declare function ensurePersonalOrg(
  sql: Sql,
  opts: { userId: string; name?: string; slug?: string },
): Promise<Organization>;

export declare function addMember(
  sql: Sql,
  opts: { orgId: string; userId: string; role?: OrgRole },
): Promise<OrgMember>;
export declare function getMembership(
  sql: Sql,
  opts: { orgId: string; userId: string },
): Promise<OrgMember | null>;
export declare function listMembers(sql: Sql, orgId: string): Promise<OrgMember[]>;
export declare function countOwners(sql: Sql, orgId: string): Promise<number>;
export declare function setRole(
  sql: Sql,
  opts: { orgId: string; userId: string; role: OrgRole },
): Promise<OrgMember | null>;
export declare function removeMember(
  sql: Sql,
  opts: { orgId: string; userId: string },
): Promise<boolean>;

export declare function createTeam(
  sql: Sql,
  opts: { orgId: string; name: string; slug?: string; userId?: string },
): Promise<Team>;
export declare function getTeam(sql: Sql, id: string): Promise<Team | null>;
export declare function listTeams(sql: Sql, orgId: string): Promise<Team[]>;
export declare function listTeamsForUser(
  sql: Sql,
  opts: { orgId: string; userId: string },
): Promise<(Team & { role: TeamRole })[]>;
export declare function updateTeam(
  sql: Sql,
  id: string,
  patch: { name?: string; slug?: string },
): Promise<Team | null>;
export declare function deleteTeam(sql: Sql, id: string): Promise<boolean>;
export declare function addTeamMember(
  sql: Sql,
  opts: { teamId: string; userId: string; role?: TeamRole },
): Promise<TeamMember>;
export declare function removeTeamMember(
  sql: Sql,
  opts: { teamId: string; userId: string },
): Promise<boolean>;
export declare function listTeamMembers(sql: Sql, teamId: string): Promise<TeamMember[]>;

export declare function can(
  sql: Sql,
  opts: { orgId: string; userId: string; role?: OrgRole },
): Promise<OrgMember | null>;
export declare function requireRole(
  sql: Sql,
  opts: { orgId: string; userId: string; role?: OrgRole },
): Promise<OrgMember>;
export declare function contextFor(
  sql: Sql,
  opts: { orgId: string; userId: string },
): Promise<OrgContext | null>;

export declare function inviteToOrg(
  sql: Sql,
  opts: {
    orgId: string;
    email: string;
    role?: OrgRole;
    invitedBy?: string;
    ttlHours?: number;
  },
): Promise<{ invite: OrgInvite; token: string }>;
export declare function listInvites(
  sql: Sql,
  orgId: string,
  opts?: { pendingOnly?: boolean },
): Promise<OrgInvite[]>;
export declare function revokeInvite(sql: Sql, id: string): Promise<boolean>;
export declare function findInvite(sql: Sql, token: string): Promise<OrgInvite | null>;
export declare function acceptInvite(
  sql: Sql,
  opts: { token: string; userId: string },
): Promise<{ invite: OrgInvite; member: OrgMember }>;
export declare function hashToken(token: string): string;
export declare function tokenMatches(token: string, storedHash: string): boolean;
