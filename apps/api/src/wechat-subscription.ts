import type { Env } from "./env.js";
import { prisma } from "./db.js";

let tokenCache: { value: string; expiresAt: number } | undefined;

async function accessToken(env: Env) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential"); url.searchParams.set("appid", env.WECHAT_APP_ID!); url.searchParams.set("secret", env.WECHAT_APP_SECRET!);
  const response = await fetch(url); const body = await response.json() as { access_token?: string; expires_in?: number; errcode?: number };
  if (!response.ok || !body.access_token) throw new Error(`wechat:${body.errcode ?? response.status}`);
  tokenCache = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000 };
  return tokenCache.value;
}

export async function processNotificationOutbox(env: Env) {
  if (env.NODE_ENV !== "production" || !env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) return 0;
  const rows = await prisma.notificationOutbox.findMany({
    where: { status: { in: ["pending", "failed"] }, attemptCount: { lt: 3 }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    include: { notification: { include: { person: { include: { account: { include: { wechatBindings: { where: { active: true } }, preferences: { where: { key: "wechat.subscriptionConsent" } } } } } } } } }, take: 50, orderBy: { createdAt: "asc" }
  });
  let sent = 0;
  for (const row of rows) {
    const notice = row.notification; const account = notice.person.account;
    const templateId = /截止|逾期/.test(notice.title) ? env.WECHAT_SUBSCRIBE_TEMPLATE_DUE : env.WECHAT_SUBSCRIBE_TEMPLATE_TASK;
    const consent = account?.preferences[0]?.value as Record<string, string> | undefined;
    const binding = account?.wechatBindings.find((item) => item.appId === env.WECHAT_APP_ID);
    if (!templateId || !binding || consent?.[templateId] !== "accept") {
      await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: "skipped", lastError: "未配置模板、未绑定或未授权" } }); continue;
    }
    try {
      const token = await accessToken(env);
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ touser: binding.openid, template_id: templateId, page: notice.assignmentId ? `pages/task/index?id=${notice.assignmentId}` : "pages/messages/index", data: { [env.WECHAT_SUBSCRIBE_FIELD_TITLE]: { value: notice.title.slice(0, 20) }, [env.WECHAT_SUBSCRIBE_FIELD_BODY]: { value: notice.body.slice(0, 20) } } })
      });
      const body = await response.json() as { errcode?: number };
      if (!response.ok || body.errcode) throw new Error(`wechat:${body.errcode ?? response.status}`);
      await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: "sent", attemptCount: { increment: 1 }, lastError: null } }); sent++;
    } catch (error) {
      const code = error instanceof Error && /^wechat:\d+$/.test(error.message) ? error.message : "wechat:network";
      await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: "failed", attemptCount: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000), lastError: code } });
    }
  }
  return sent;
}
