import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  migrate, createOrg, getOrgBySlug, listOrgsForUser, ensurePersonalOrg,
  addMember, getMembership, setRole, removeMember, countOwners,
  createTeam, listTeams, addTeamMember, listTeamMembers, removeTeamMember,
  can, requireRole, contextFor,
  inviteToOrg, findInvite, acceptInvite, revokeInvite, listInvites, hashToken,
  slugify, atLeast,
} from "../src/index.js";

const URL = process.env.TEST_DATABASE_URL
  ?? "postgres://postgres:test@127.0.0.1:55460/orgs_test";

let sql;
const uid = () => crypto.randomUUID();

before(async () => {
  sql = postgres(URL, { onnotice: () => {} });
  await migrate(sql);
});
after(async () => { await sql?.end(); });
beforeEach(async () => {
  await sql`truncate organizations, org_invites restart identity cascade`;
});

describe("roles", () => {
  test("a check is 'at least', so an owner passes an admin gate", () => {
    assert.ok(atLeast("owner", "admin"));
    assert.ok(atLeast("admin", "member"));
    assert.ok(atLeast("member", "member"));
    assert.ok(!atLeast("member", "admin"));
    assert.ok(!atLeast("nonsense", "member"), "an unknown role is never enough");
  });
  test("slugs are url-safe and never empty", () => {
    assert.equal(slugify("Acme Corp"), "acme-corp");
    assert.equal(slugify("  Héllo Wörld! "), "hello-world");
    assert.equal(slugify("!!!"), "org");
  });
});

describe("organizations", () => {
  test("the creator comes out an owner", async () => {
    const me = uid();
    const org = await createOrg(sql, { name: "Acme", userId: me });
    assert.equal(org.slug, "acme");
    const m = await getMembership(sql, { orgId: org.id, userId: me });
    assert.equal(m.role, "owner");
  });

  test("a clashing name gets its own slug", async () => {
    await createOrg(sql, { name: "Acme", userId: uid() });
    const second = await createOrg(sql, { name: "Acme", userId: uid() });
    assert.equal(second.slug, "acme-2");
    assert.ok(await getOrgBySlug(sql, "acme"));
  });

  test("a personal org is made once and then reused", async () => {
    const me = uid();
    const a = await ensurePersonalOrg(sql, { userId: me, name: "me@x.com" });
    const b = await ensurePersonalOrg(sql, { userId: me, name: "me@x.com" });
    assert.equal(a.id, b.id);
    assert.equal(a.is_personal, true);
  });

  test("listing can hide personal orgs from a chooser", async () => {
    const me = uid();
    await ensurePersonalOrg(sql, { userId: me, name: "personal" });
    await createOrg(sql, { name: "Work", userId: me });
    assert.equal((await listOrgsForUser(sql, me)).length, 2);
    const real = await listOrgsForUser(sql, me, { includePersonal: false });
    assert.equal(real.length, 1);
    assert.equal(real[0].name, "Work");
  });
});

describe("the last owner", () => {
  test("cannot demote themselves", async () => {
    const me = uid();
    const org = await createOrg(sql, { name: "Solo", userId: me });
    await assert.rejects(
      () => setRole(sql, { orgId: org.id, userId: me, role: "admin" }),
      /at least one owner/,
      "an org with no owner can never be administered again",
    );
    assert.equal(await countOwners(sql, org.id), 1);
  });

  test("cannot be removed", async () => {
    const me = uid();
    const org = await createOrg(sql, { name: "Solo", userId: me });
    await assert.rejects(() => removeMember(sql, { orgId: org.id, userId: me }), /at least one owner/);
  });

  test("can step down once someone else is an owner", async () => {
    const me = uid(), you = uid();
    const org = await createOrg(sql, { name: "Duo", userId: me });
    await addMember(sql, { orgId: org.id, userId: you, role: "owner" });
    const demoted = await setRole(sql, { orgId: org.id, userId: me, role: "member" });
    assert.equal(demoted.role, "member");
  });
});

describe("teams", () => {
  test("two organizations may both have a team of the same name", async () => {
    const a = await createOrg(sql, { name: "A", userId: uid() });
    const b = await createOrg(sql, { name: "B", userId: uid() });
    const ta = await createTeam(sql, { orgId: a.id, name: "Design" });
    const tb = await createTeam(sql, { orgId: b.id, name: "Design" });
    assert.equal(ta.slug, "design");
    assert.equal(tb.slug, "design", "team slugs are scoped to their org");
  });

  test("a team seat cannot be a way around org membership", async () => {
    const owner = uid(), outsider = uid();
    const org = await createOrg(sql, { name: "Acme", userId: owner });
    const team = await createTeam(sql, { orgId: org.id, name: "Design", userId: owner });
    await assert.rejects(
      () => addTeamMember(sql, { teamId: team.id, userId: outsider }),
      /not a member of the team's organization/,
    );
  });

  test("leaving the org gives up its team seats", async () => {
    const owner = uid(), them = uid();
    const org = await createOrg(sql, { name: "Acme", userId: owner });
    const team = await createTeam(sql, { orgId: org.id, name: "Design", userId: owner });
    await addMember(sql, { orgId: org.id, userId: them });
    await addTeamMember(sql, { teamId: team.id, userId: them });
    assert.equal((await listTeamMembers(sql, team.id)).length, 2);

    await removeMember(sql, { orgId: org.id, userId: them });
    const left = await listTeamMembers(sql, team.id);
    assert.equal(left.length, 1, "a team seat in a company you left is not a seat");
    assert.equal(left[0].user_id, owner);
  });

  test("deleting an org takes its teams with it", async () => {
    const me = uid();
    const org = await createOrg(sql, { name: "Acme", userId: me });
    await createTeam(sql, { orgId: org.id, name: "Design", userId: me });
    await sql`delete from organizations where id = ${org.id}`;
    assert.equal((await listTeams(sql, org.id)).length, 0);
  });
});

describe("access", () => {
  test("can() answers with the membership, so callers need not ask twice", async () => {
    const me = uid();
    const org = await createOrg(sql, { name: "Acme", userId: me });
    const m = await can(sql, { orgId: org.id, userId: me, role: "admin" });
    assert.equal(m.role, "owner");
  });

  test("a stranger is refused, and requireRole throws 403", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    assert.equal(await can(sql, { orgId: org.id, userId: uid() }), null);
    await assert.rejects(
      () => requireRole(sql, { orgId: org.id, userId: uid() }),
      (err) => err.status === 403 && err.code === "FORBIDDEN",
    );
  });

  test("a member is not an admin", async () => {
    const owner = uid(), them = uid();
    const org = await createOrg(sql, { name: "Acme", userId: owner });
    await addMember(sql, { orgId: org.id, userId: them });
    assert.ok(await can(sql, { orgId: org.id, userId: them, role: "member" }));
    assert.equal(await can(sql, { orgId: org.id, userId: them, role: "admin" }), null);
  });

  test("context carries the role and the teams in one go", async () => {
    const me = uid();
    const org = await createOrg(sql, { name: "Acme", userId: me });
    await createTeam(sql, { orgId: org.id, name: "Design", userId: me });
    const ctx = await contextFor(sql, { orgId: org.id, userId: me });
    assert.equal(ctx.role, "owner");
    assert.equal(ctx.teams.length, 1);
    assert.equal(ctx.teams[0].role, "lead");
  });
});

describe("invitations", () => {
  test("the token is returned once and only its hash is stored", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    const { invite, token } = await inviteToOrg(sql, { orgId: org.id, email: "a@b.com" });
    assert.ok(token.length > 20);
    assert.equal(invite.token_hash, hashToken(token));
    assert.ok(!JSON.stringify(invite).includes(token), "the raw token is never persisted");
  });

  test("accepting makes a member, and the link cannot be used twice", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    const { token } = await inviteToOrg(sql, { orgId: org.id, email: "a@b.com", role: "admin" });
    const them = uid();
    const { member } = await acceptInvite(sql, { token, userId: them });
    assert.equal(member.role, "admin");
    await assert.rejects(() => acceptInvite(sql, { token, userId: uid() }), /no longer valid/);
  });

  test("two people racing the same link, only one wins", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    const { token } = await inviteToOrg(sql, { orgId: org.id, email: "a@b.com" });
    const results = await Promise.allSettled([
      acceptInvite(sql, { token, userId: uid() }),
      acceptInvite(sql, { token, userId: uid() }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 1, "an invitation is for one seat");
  });

  test("re-inviting replaces, so an old link cannot grant a revised role", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    const first = await inviteToOrg(sql, { orgId: org.id, email: "a@b.com", role: "owner" });
    const second = await inviteToOrg(sql, { orgId: org.id, email: "a@b.com", role: "member" });
    assert.equal(await findInvite(sql, first.token), null, "the superseded link is dead");
    const { member } = await acceptInvite(sql, { token: second.token, userId: uid() });
    assert.equal(member.role, "member");
  });

  test("revoked and expired links do not resolve", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    const { invite, token } = await inviteToOrg(sql, { orgId: org.id, email: "a@b.com" });
    await revokeInvite(sql, invite.id);
    assert.equal(await findInvite(sql, token), null);

    const expired = await inviteToOrg(sql, { orgId: org.id, email: "c@d.com", ttlHours: -1 });
    assert.equal(await findInvite(sql, expired.token), null);
  });

  test("a garbage token is simply not found", async () => {
    assert.equal(await findInvite(sql, "not-a-token"), null);
    assert.equal(await findInvite(sql, ""), null);
  });

  test("pending listing hides what has been dealt with", async () => {
    const org = await createOrg(sql, { name: "Acme", userId: uid() });
    await inviteToOrg(sql, { orgId: org.id, email: "keep@x.com" });
    const { invite } = await inviteToOrg(sql, { orgId: org.id, email: "gone@x.com" });
    await revokeInvite(sql, invite.id);
    const pending = await listInvites(sql, org.id);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].email, "keep@x.com");
    assert.equal((await listInvites(sql, org.id, { pendingOnly: false })).length, 2);
  });
});
