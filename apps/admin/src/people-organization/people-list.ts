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

export type PeopleListState = {
  search: string;
  organizationId?: string | undefined;
  personStatus?: string | undefined;
  accountStatus?: string | undefined;
  role?: string | undefined;
  view: PeopleView;
  page: number;
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

export function readPeopleListState(search: URLSearchParams): PeopleListState {
  const page = Number.parseInt(search.get("page") ?? "1", 10);
  return {
    search: search.get("q") ?? "",
    organizationId: search.get("organizationId") || undefined,
    personStatus: search.get("personStatus") || undefined,
    accountStatus: search.get("accountStatus") || undefined,
    role: search.get("role") || undefined,
    view: readPeopleView(search.get("view")),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function writePeopleListState(state: PeopleListState) {
  const search = new URLSearchParams();
  if (state.search) search.set("q", state.search);
  if (state.organizationId) search.set("organizationId", state.organizationId);
  if (state.personStatus) search.set("personStatus", state.personStatus);
  if (state.accountStatus) search.set("accountStatus", state.accountStatus);
  if (state.role) search.set("role", state.role);
  if (state.view === "grouped") search.set("view", state.view);
  if (state.page > 1) search.set("page", String(state.page));
  return search;
}

export function readPeopleView(value: string | null): PeopleView {
  return value === "grouped" ? "grouped" : "list";
}
