FROM node:22-bookworm-slim AS build

WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/git-core/package.json packages/git-core/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui-components/package.json packages/ui-components/package.json

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm --filter @git-webui/server deploy --prod --legacy /tmp/git-webui-server

FROM node:22-bookworm-slim AS server-runtime

WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /var/lib/git-webui && chown -R node:node /var/lib/git-webui
COPY --from=build /tmp/git-webui-server ./
ENV NODE_ENV=production
ENV GIT_WEBUI_HOST=0.0.0.0
ENV GIT_WEBUI_PORT=3000
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]

FROM nginx:1.27-alpine AS web-runtime

COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
