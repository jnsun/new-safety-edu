import type { Env } from "./env.js";
import { prisma } from "./db.js";
import { getWechatAccessToken } from "./wechat-api.js";

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
      const token = await getWechatAccessToken(env);
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
