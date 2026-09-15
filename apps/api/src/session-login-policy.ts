import type { AccountStatus } from "@prisma/client";

type LoginMethods = { password: boolean; phone: boolean; wechat: boolean };

export function accountStatusAfterLoginMethodChange(current: AccountStatus, methods: LoginMethods): AccountStatus {
  if (current === "disabled" || current === "merged") return current;
  return Object.values(methods).some(Boolean) ? "active" : "pending";
}

export function assertLoginMethodCanBeRemoved(input: { method: keyof LoginMethods; targetIsLastCompanyAdmin: boolean; otherWebLoginAvailable: boolean }) {
  if (input.method === "password" && input.targetIsLastCompanyAdmin && !input.otherWebLoginAvailable) {
    throw Object.assign(new Error("最后一名公司管理员必须保留后台登录方式"), { statusCode: 409, code: "LAST_COMPANY_ADMIN_LOGIN_METHOD" });
  }
}
