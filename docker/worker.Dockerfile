FROM node:24.8.0-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @saydian/app-worker... --filter @saydian/app-api
COPY packages/contracts packages/contracts
COPY apps/api/prisma apps/api/prisma
COPY apps/worker apps/worker
RUN pnpm --filter @saydian/app-contracts build \
 && pnpm --filter @saydian/app-api prisma:generate \
 && pnpm --filter @saydian/app-worker build

FROM node:24.8.0-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts ./packages/contracts
COPY --from=build --chown=node:node /workspace/apps/worker ./apps/worker
USER node
WORKDIR /workspace/apps/worker
CMD ["node", "dist/main.js"]
