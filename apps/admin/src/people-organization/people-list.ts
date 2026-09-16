export type PeopleView = "list" | "grouped";

export type PeopleListRow = {
  id: string;
  name: string;
  phone: string;
  status: string;
  type: string;
  organizationIds: string[];
  organizationNames: string[];
  accountStatus: string;
  username: string | null;
  roles: string[];
};

export type PeopleFilters = {
  search?: string | undefined;
  organizationId?: string | undefined;
  personStatus?: string | undefined;
  accountStatus?: string | undefined;
  role?: string | undefined;
};

export function filterPeopleRows<T extends PeopleListRow>(rows: T[], filters: PeopleFilters) {
  const search = filters.search?.trim().toLocaleLowerCase("zh-CN") ?? "";
  return rows.filter((row) => {
    if (filters.organizationId && !row.organizationIds.includes(filters.organizationId)) return false;
    if (filters.personStatus && row.status !== filters.personStatus) return false;
    if (filters.accountStatus && row.accountStatus !== filters.accountStatus) return false;
    if (filters.role && !row.roles.includes(filters.role)) return false;
    if (!search) return true;
    return [row.name, row.phone, row.username ?? "", ...row.organizationNames]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(search));
  });
}

export function peopleInOrganization<T extends { organizations: Array<{ organization: { id: string } }> }>(rows: T[], organizationId?: string) {
  if (!organizationId) return [];
  return rows.filter((row) => row.organizations.some(({ organization }) => organization.id === organizationId));
}

export function readPeopleView(value: string | null): PeopleView {
  return value === "grouped" ? "grouped" : "list";
}
