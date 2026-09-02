FROM node:24.8.0-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN pnpm install --frozen-lockfile --filter @saydian/app-admin-web
COPY apps/admin-web apps/admin-web
RUN pnpm --filter @saydian/app-admin-web build

FROM nginxinc/nginx-unprivileged:1.27.3-alpine
COPY docker/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 8080
