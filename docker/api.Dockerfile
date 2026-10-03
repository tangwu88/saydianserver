FROM node:24.8.0-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/commerce-domain/package.json packages/commerce-domain/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @saydian/app-api...
COPY packages/contracts packages/contracts
COPY packages/commerce-domain packages/commerce-domain
COPY apps/api apps/api
RUN pnpm --filter @saydian/app-contracts build \
 && pnpm --filter @saydian/app-api prisma:generate \
 && pnpm --filter @saydian/commerce-domain build \
 && pnpm --filter @saydian/app-api build \
 && pnpm --filter @saydian/app-api deploy --prod /runtime/api \
 && cd /runtime/api && ./node_modules/.bin/prisma generate

FROM node:24.8.0-alpine AS runtime
WORKDIR /workspace/apps/api
ENV NODE_ENV=production
RUN apk add --no-cache font-noto-cjk
RUN mkdir -p /var/lib/saydian/say-ring-avatars \
 && chown node:node /var/lib/saydian/say-ring-avatars \
 && chmod 0700 /var/lib/saydian/say-ring-avatars
COPY --from=build --chown=node:node /runtime/api/node_modules ./node_modules
COPY --from=build --chown=node:node /runtime/api/package.json ./package.json
COPY --from=build --chown=node:node /runtime/api/prisma ./prisma
COPY --from=build --chown=node:node /runtime/api/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
