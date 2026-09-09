FROM node:24.8.0-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @saydian/app-admin-web --filter @saydian/app-contracts
COPY apps/admin-web apps/admin-web
COPY packages/contracts packages/contracts
ENV VITE_BASE_PATH=/admin/
RUN pnpm --filter @saydian/app-contracts build && pnpm --filter @saydian/app-admin-web build

FROM nginxinc/nginx-unprivileged:1.27.3-alpine
COPY deploy/global/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin-web/dist /usr/share/nginx/html/admin
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
