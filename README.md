# 安全生产管理平台

单仓库安全生产管理平台：Fastify API、React 管理后台、PostgreSQL/Prisma 与原生微信小程序。当前模块包括培训教育、野外项目月报和资质证照；客户端只通过 API 访问业务数据。

## 本地启动

要求 Node.js 22 LTS、pnpm、PostgreSQL 15+。Docker 可用时可只启动数据库：

```bash
docker compose up -d postgres
cp .env.example .env
pnpm install
pnpm prisma:generate
pnpm db:migrate --name v0_1_initial
pnpm db:bootstrap
pnpm dev
```

生成 `FIELD_ENCRYPTION_KEY` 示例：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`。其余 secret 应使用独立随机值。首次管理员创建成功后立即删除 `ADMIN_BOOTSTRAP_PASSWORD`。

- 管理后台开发地址：`http://localhost:5173`
- API：`http://localhost:3000/api`
- 小程序：微信开发者工具导入 `apps/miniprogram`；开发态 API 地址见 `config/env.js`

生产环境绝不启用微信 Mock。`var/uploads` 必须持久化且不应由 Web 服务器公开映射。

短信验证码不作为独立登录方式，只用于微信首次绑定、微信换绑、修改手机号和手机号真实性验证。启用短信验证需要服务器配置 `SMS_SEND_ENDPOINT` 和 `SMS_SEND_TOKEN`；网关接收 HTTPS JSON `{ phone, code, purpose }`。网页后台以微信扫码登录为主、用户名密码为备用；启用扫码登录需要在微信开放平台创建网站应用，并在服务器配置 `WECHAT_WEB_APP_ID`、`WECHAT_WEB_APP_SECRET` 和回调地址 `WECHAT_WEB_REDIRECT_URI`。这些密钥不得进入 Admin 或小程序构建产物。

## 常用命令

```bash
pnpm typecheck
pnpm build
pnpm db:validate
pnpm db:deploy
pnpm db:bootstrap
pnpm check:context-closure
```

生产维护命令默认只预览：`pnpm retention`、`pnpm files:cleanup-orphans`、`pnpm audit:replay`、`pnpm capacity:check`。执行清理或审计补写时必须显式增加 `--apply`；生产环境还必须增加 `--confirm-production`。完整操作见 `docs/mvp-deploy.md`。
