FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma:generate && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app /app
RUN mkdir -p /app/var/uploads && chown app:app /app/var/uploads
USER app
EXPOSE 3000
CMD ["pnpm", "--filter", "@safety/api", "start"]
