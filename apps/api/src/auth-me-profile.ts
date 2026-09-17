type AuthMeAccount = {
  username: string | null;
  person: {
    name: string;
    organizations: Array<{ organization: { id: string; name: string } }>;
  } | null;
};

export function authMeProfile(account: AuthMeAccount) {
  return {
    displayName: account.person?.name ?? account.username ?? "未关联人员",
    primaryOrganization: account.person?.organizations[0]?.organization ?? null,
  };
}
