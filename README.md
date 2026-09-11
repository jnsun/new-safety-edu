# 物化院有限公司安全培训教育平台 V0.1

全新单仓库 MVP：Fastify API、React 管理后台、PostgreSQL/Prisma 与原生微信小程序。客户端只通过 API 访问业务数据。

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

## 常用命令

```bash
pnpm typecheck
pnpm build
pnpm db:validate
pnpm db:deploy
pnpm db:bootstrap
```
