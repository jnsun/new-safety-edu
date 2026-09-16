export type PlatformConditionalModule = "receivables" | "incident";

export function platformConditionalModule(canEnterReceivables: boolean): PlatformConditionalModule {
  return canEnterReceivables ? "receivables" : "incident";
}
