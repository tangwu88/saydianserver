FROM node:24.8.0-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @saydian/app-api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @saydian/app-contracts build \
 && pnpm --filter @saydian/app-api prisma:generate \
 && pnpm --filter @saydian/app-api build

FROM node:24.8.0-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
RUN apk add --no-cache font-noto-cjk
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts ./packages/contracts
COPY --from=build --chown=node:node /workspace/apps/api ./apps/api
COPY --from=build --chown=node:node /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
USER node
WORKDIR /workspace/apps/api
EXPOSE 8080
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx prisma/seed.ts && node dist/main.js"]
