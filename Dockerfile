# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# 安装全部依赖（包含 devDependencies，用于编译 TypeScript）
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
# 只安装生产依赖
RUN npm ci --omit=dev

# 从 builder 拷贝编译产物
COPY --from=builder /app/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
