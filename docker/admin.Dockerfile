FROM node:24.8.0-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/download-web/package.json apps/download-web/package.json
COPY apps/shop/package.json apps/shop/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @saydian/app-admin-web --filter @saydian/app-download-web --filter @saydian/app-shop --filter @saydian/app-contracts
COPY apps/admin-web apps/admin-web
COPY apps/download-web apps/download-web
COPY apps/shop apps/shop
COPY packages/contracts packages/contracts
RUN pnpm --filter @saydian/app-contracts build && pnpm --filter @saydian/app-admin-web build && pnpm --filter @saydian/app-download-web build && pnpm --filter @saydian/app-shop build:h5

FROM nginxinc/nginx-unprivileged:1.27.3-alpine
COPY docker/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin-web/dist /usr/share/nginx/html/admin
COPY --from=build /workspace/apps/download-web/dist /usr/share/nginx/html/down
COPY --from=build /workspace/apps/shop/dist/build/h5 /usr/share/nginx/html/saidian-mall
EXPOSE 8080
