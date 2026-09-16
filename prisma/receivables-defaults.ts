export function selectFinanceOrganizationId(organizations: readonly { id: string }[]): string {
  if (organizations.length !== 1) throw new Error("财务资产部必须且只能存在一个");
  return organizations[0]!.id;
}

export function receivableSettingBinding(currentOrganizationId: string | null | undefined, financeOrganizationId: string) {
  return currentOrganizationId === financeOrganizationId
    ? { financeOrganizationId }
    : { financeOrganizationId, configurationConfirmedAt: null, configurationConfirmedBy: null };
}
