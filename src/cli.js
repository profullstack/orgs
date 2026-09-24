#!/usr/bin/env node
/**
 * orgs - manage organizations, teams and members from a terminal.
 *
 * The sysop works from a terminal, so every table this package owns is
 * reachable without a web app in front of it. Reads DATABASE_URL.
 */
import postgres from "postgres";
import {
  migrate, createOrg, getOrgBySlug, listOrgsForUser, deleteOrg,
  addMember, listMembers, setRole, removeMember,
  createTeam, listTeams, addTeamMember, listTeamMembers,
  inviteToOrg, listInvites, revokeInvite, acceptInvite,
} from "./index.js";

const USAGE = `orgs - organizations, teams and members

  orgs migrate                                apply the schema
  orgs create <name> --user <uuid>            create an org, creator becomes owner
  orgs list --user <uuid>                     orgs a user belongs to
  orgs show <slug>                            one org and its members
  orgs delete <slug>                          delete an org and everything in it

  orgs member add <slug> <uuid> [--role r]    add or change a member
  orgs member rm <slug> <uuid>                remove a member
  orgs member role <slug> <uuid> <role>       set a role (member|admin|owner)

  orgs team create <slug> <name>              create a team in an org
  orgs team list <slug>                       teams in an org
  orgs team add <slug> <team> <uuid> [--role] put a member on a team
  orgs team members <slug> <team>             who is on a team

  orgs invite <slug> <email> [--role r]       mint an invitation, prints the token
  orgs invites <slug>                         pending invitations
  orgs revoke <id>                            revoke an invitation
  orgs accept <token> --user <uuid>           accept one

Environment: DATABASE_URL`;

const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  else args.push(argv[i]);
}

if (!args.length || flags.help || args[0] === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const out = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Most commands name an org by slug, which is friendlier than a uuid. */
async function orgBySlug(slug) {
  const org = await getOrgBySlug(sql, slug);
  if (!org) throw new Error(`no organization with slug "${slug}"`);
  return org;
}

try {
  const [cmd, a, b, c] = args;
  switch (cmd) {
    case "migrate":
      await migrate(sql);
      out("schema applied");
      break;
    case "create":
      out(await createOrg(sql, { name: a, userId: flags.user }));
      break;
    case "list":
      out(await listOrgsForUser(sql, flags.user));
      break;
    case "show": {
      const org = await orgBySlug(a);
      out({ ...org, members: await listMembers(sql, org.id) });
      break;
    }
    case "delete":
      out(await deleteOrg(sql, (await orgBySlug(a)).id) ? "deleted" : "not found");
      break;
    case "member": {
      const org = await orgBySlug(b);
      if (a === "add") out(await addMember(sql, { orgId: org.id, userId: c, role: flags.role || "member" }));
      else if (a === "rm") out(await removeMember(sql, { orgId: org.id, userId: c }) ? "removed" : "not a member");
      else if (a === "role") out(await setRole(sql, { orgId: org.id, userId: c, role: args[4] }));
      else throw new Error(`unknown member command: ${a}`);
      break;
    }
    case "team": {
      const org = await orgBySlug(b);
      if (a === "create") out(await createTeam(sql, { orgId: org.id, name: c, userId: flags.user }));
      else if (a === "list") out(await listTeams(sql, org.id));
      else if (a === "add") {
        const [team] = (await listTeams(sql, org.id)).filter((t) => t.slug === c);
        if (!team) throw new Error(`no team "${c}" in ${b}`);
        out(await addTeamMember(sql, { teamId: team.id, userId: args[4], role: flags.role || "member" }));
      } else if (a === "members") {
        const [team] = (await listTeams(sql, org.id)).filter((t) => t.slug === c);
        if (!team) throw new Error(`no team "${c}" in ${b}`);
        out(await listTeamMembers(sql, team.id));
      } else throw new Error(`unknown team command: ${a}`);
      break;
    }
    case "invite": {
      const org = await orgBySlug(a);
      const { invite, token } = await inviteToOrg(sql, {
        orgId: org.id, email: b, role: flags.role || "member", invitedBy: flags.user,
      });
      // Shown once, because only the hash is kept.
      out({ id: invite.id, email: invite.email, role: invite.role, expires_at: invite.expires_at, token });
      break;
    }
    case "invites":
      out(await listInvites(sql, (await orgBySlug(a)).id));
      break;
    case "revoke":
      out(await revokeInvite(sql, a) ? "revoked" : "not found or already dealt with");
      break;
    case "accept":
      out(await acceptInvite(sql, { token: a, userId: flags.user }));
      break;
    default:
      console.error(`unknown command: ${cmd}\n\n${USAGE}`);
      process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await sql.end();
}
