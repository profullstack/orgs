# @profullstack/orgs

Organizations, teams, members, roles and invitations for Postgres.

Bring your own users table and your own auth. This package never owns user
identity: `user_id` is a bare uuid with an index and no foreign key, because
your users table may be named anything, live in another schema, or not be in
this database at all. Removing a user stays your job.

```bash
npm i @profullstack/orgs postgres
```

## Shape

```
organization            the tenancy boundary: a company, or one person's own
 ├─ members             user + role: owner > admin > member
 ├─ teams               optional grouping inside one org
 │   └─ members         user + role: lead > member
 └─ invites             emailed, hashed, single use
```

A team only exists inside an organization, and a team seat is a subset of org
membership rather than a way around it: adding someone to a team who is not in
the org is refused.

## Use

```js
import postgres from "postgres";
import {
  migrate, createOrg, addMember, createTeam, addTeamMember,
  can, requireRole, inviteToOrg, acceptInvite, ensurePersonalOrg,
} from "@profullstack/orgs";

const sql = postgres(process.env.DATABASE_URL);
await migrate(sql);                       // safe to run repeatedly

const org = await createOrg(sql, { name: "Acme", userId: me });
// the creator is the owner, in the same transaction

await addMember(sql, { orgId: org.id, userId: them, role: "admin" });

const design = await createTeam(sql, { orgId: org.id, name: "Design", userId: me });
await addTeamMember(sql, { teamId: design.id, userId: them, role: "lead" });
```

### Guarding a request

`can` returns the membership when allowed and `null` when not, so the caller can
use the role it already looked up instead of asking twice. `requireRole` is the
same check as a guard and throws a 403.

```js
const membership = await can(sql, { orgId, userId, role: "admin" });
if (!membership) return new Response("nope", { status: 403 });

await requireRole(sql, { orgId, userId, role: "owner" });  // throws 403
```

Role checks are always "at least", never equality, so an owner passes an admin
gate without anyone writing `role === "owner" || role === "admin"`.

### Invitations

The token is returned once, at creation, because it has to reach the invitee
now. Only its SHA-256 hash is stored, so a leaked database does not hand out
memberships.

```js
const { token } = await inviteToOrg(sql, { orgId, email: "a@b.com", role: "admin" });
await sendEmail(`https://example.com/join/${token}`);

const { member } = await acceptInvite(sql, { token, userId });
```

Re-inviting the same address replaces the pending invitation rather than adding
a second one, so an older link cannot grant a role that was since revised. Two
people racing the same link: exactly one wins, because the row is claimed with a
conditional update inside the transaction.

### Adding tenancy to an app that already has users

Every app that does this has the same problem: work already exists and belongs
to a person, not a company.

```js
const org = await ensurePersonalOrg(sql, { userId, name: email });
await sql`update things set org_id = ${org.id} where user_id = ${userId}`;
```

Personal orgs carry `is_personal = true` and are hidden by
`listOrgsForUser(sql, userId, { includePersonal: false })`, so a "pick an
organization" menu does not show everyone their own name.

## Guarantees worth knowing

- **An org always has an owner.** Demoting or removing the last one is refused.
  An org with no owner can never be administered or deleted by anyone again.
- **Creation is atomic.** The org and its owner row go in one transaction; a
  half-made org is worse than none.
- **Leaving an org gives up its team seats**, so nobody keeps a seat on a team
  in a company they are no longer part of.
- **Team slugs are scoped to their org.** Two companies may both have `design`.

## API

Everything takes the `sql` client as its first argument.

| | |
| --- | --- |
| `migrate(sql)`, `SCHEMA_SQL` | apply or read the schema |
| `createOrg`, `getOrg`, `getOrgBySlug`, `listOrgsForUser`, `updateOrg`, `deleteOrg`, `ensurePersonalOrg` | organizations |
| `addMember`, `getMembership`, `listMembers`, `countOwners`, `setRole`, `removeMember` | membership |
| `createTeam`, `getTeam`, `listTeams`, `listTeamsForUser`, `updateTeam`, `deleteTeam`, `addTeamMember`, `removeTeamMember`, `listTeamMembers` | teams |
| `can`, `requireRole`, `contextFor` | access |
| `inviteToOrg`, `listInvites`, `revokeInvite`, `findInvite`, `acceptInvite`, `hashToken`, `tokenMatches` | invitations |
| `atLeast`, `teamAtLeast`, `isOrgRole`, `isTeamRole`, `slugify`, `uniqueSlug` | helpers |

## Tests

They run against a real Postgres, because the things worth testing here are
transactions, constraints and races.

```bash
docker run -d --name orgs-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=orgs_test \
  -p 127.0.0.1:55460:5432 postgres:17-alpine
npm test
```

Point them elsewhere with `TEST_DATABASE_URL`.

## License

MIT

## CLI

The sysop works from a terminal, so every table here is reachable without a web
app in front of it.

```bash
export DATABASE_URL=postgres://...
npx @profullstack/orgs migrate
npx @profullstack/orgs create "Acme Inc" --user <uuid>
npx @profullstack/orgs member add acme-inc <uuid> --role admin
npx @profullstack/orgs team create acme-inc Design
npx @profullstack/orgs invite acme-inc bob@example.com --role admin
```

`orgs help` lists the rest. The invite command prints the token once, because
only its hash is stored.
