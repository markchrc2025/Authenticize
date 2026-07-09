# syntax=docker/dockerfile:1

# ---- Build stage: install all deps and compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage: production deps + compiled output only ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Sliplane auto-detects the exposed port from this instruction.
EXPOSE 3000

USER node
CMD ["node", "dist/index.js"]
