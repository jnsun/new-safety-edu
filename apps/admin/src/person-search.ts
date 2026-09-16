type SearchablePerson = {
  name: string;
  phone: string;
  type: string;
  status: string;
  organizations: Array<{ organization: { name: string } }>;
};

const searchLabels: Record<string, string> = {
  employee: "正式员工",
  contractor: "外协人员",
  temporary_individual: "临时个人",
  active: "正常",
  pending: "待审核",
  disabled: "已停用",
  merged: "已合并",
};

export function personMatchesSearch(person: SearchablePerson, query: string) {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return true;
  return [
    person.name,
    person.phone,
    searchLabels[person.type] ?? person.type,
    searchLabels[person.status] ?? person.status,
    ...person.organizations.map(({ organization }) => organization.name),
  ].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword));
}
