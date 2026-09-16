export type PeopleOrganizationNavItem = {
  key: string;
  label: string;
  icon: "people" | "organization" | "project" | "review" | "tools" | "account";
  companyAdminOnly?: boolean;
};

export const peopleOrganizationNav: readonly PeopleOrganizationNavItem[] = [
  { key: "/people", label: "人员档案", icon: "people" },
  { key: "/organization", label: "组织与职责", icon: "organization" },
  { key: "/projects", label: "项目与成员", icon: "project" },
  { key: "/people/reviews", label: "审核中心", icon: "review" },
  { key: "/people/tools", label: "数据工具", icon: "tools" },
  { key: "/people/account-issues", label: "账号异常处理", icon: "account", companyAdminOnly: true },
] as const;

export function masterDataSelectedKey(pathname: string) {
  const exact = peopleOrganizationNav.find((item) => item.key === pathname);
  if (exact) return exact.key;
  if (pathname.startsWith("/people/")) return "/people";
  if (pathname.startsWith("/organization")) return "/organization";
  if (pathname.startsWith("/projects")) return "/projects";
  return "/people";
}
