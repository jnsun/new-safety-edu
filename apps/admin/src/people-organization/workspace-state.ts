export const organizationGroupOrder = ["business_entity", "department", "contractor"] as const;

export type OrganizationDirectoryRow = {
  id: string;
  name: string;
  type: string;
  memberCount: number;
};

export function groupOrganizations<T extends OrganizationDirectoryRow>(rows: T[]) {
  return organizationGroupOrder
    .map((type) => ({
      type,
      rows: rows
        .filter((row) => row.type === type)
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    }))
    .filter((group) => group.rows.length);
}

export function readWorkspaceSelection(search: URLSearchParams, key: string, availableIds: string[]) {
  const requested = search.get(key);
  return requested && availableIds.includes(requested) ? requested : availableIds[0];
}

export function writeWorkspaceSelection(search: URLSearchParams, key: string, id: string) {
  const next = new URLSearchParams(search);
  next.set(key, id);
  return next;
}

export function workspaceViewportClass({ compact }: { compact: boolean }) {
  return `master-workbench${compact ? " is-compact" : ""}`;
}
