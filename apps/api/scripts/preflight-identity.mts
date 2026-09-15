import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const checks: Array<[string, string]> = [
  ["duplicate_primary_memberships", `SELECT COUNT(*)::int AS count FROM (SELECT person_id FROM organization_memberships WHERE active AND "primary" GROUP BY person_id HAVING COUNT(*) > 1) q`],
  ["duplicate_current_leaders", `SELECT COUNT(*)::int AS count FROM (SELECT scope_id FROM role_assignments WHERE role = 'org_leader' AND scope_type = 'organization' AND (active OR activation_pending) GROUP BY scope_id HAVING COUNT(*) > 1) q`],
  ["duplicate_current_roles", `SELECT COUNT(*)::int AS count FROM (SELECT person_id, role, scope_type, scope_id FROM role_assignments WHERE (active OR activation_pending) AND person_id IS NOT NULL GROUP BY person_id, role, scope_type, scope_id HAVING COUNT(*) > 1) q`],
  ["duplicate_pending_requests", `SELECT COUNT(*)::int AS count FROM (SELECT request_key FROM change_requests WHERE status = 'pending' AND request_key IS NOT NULL GROUP BY request_key HAVING COUNT(*) > 1) q`],
  ["duplicate_active_wechat_accounts", `SELECT COUNT(*)::int AS count FROM (SELECT account_id, app_id FROM wechat_bindings WHERE active GROUP BY account_id, app_id HAVING COUNT(*) > 1) q`],
  ["orphan_management_roles", `SELECT COUNT(*)::int AS count FROM role_assignments WHERE (active OR activation_pending) AND role <> 'learner' AND person_id IS NULL AND NOT (role = 'company_admin' AND scope_type = 'company' AND scope_id IS NULL)`],
  ["disabled_people_with_current_roles", `SELECT COUNT(*)::int AS count FROM role_assignments r JOIN persons p ON p.id = r.person_id WHERE p.status <> 'active' AND (r.active OR r.activation_pending)`],
  ["disabled_people_with_current_projects", `SELECT COUNT(*)::int AS count FROM project_members m JOIN persons p ON p.id = m.person_id WHERE p.status <> 'active' AND m.status IN ('pending','approved','active')`],
  ["department_people_in_projects", `SELECT COUNT(*)::int AS count FROM project_members m JOIN organization_memberships om ON om.person_id = m.person_id AND om.active AND om."primary" JOIN organizations o ON o.id = om.organization_id WHERE m.status IN ('pending','approved','active') AND o.type = 'department'`]
];

try {
  let conflicts = 0;
  for (const [name, sql] of checks) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(sql);
    const count = Number(rows[0]?.count ?? 0); conflicts += count;
    console.log(`${name}=${count}`);
  }
  console.log(`IDENTITY_PREFLIGHT=${conflicts ? "BLOCKED" : "PASS"}`);
  if (conflicts) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
