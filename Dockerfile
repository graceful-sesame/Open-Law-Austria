FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production image ----
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl (needed by risClient for RIS HTML fetching)
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets
COPY --from=builder /app/dist ./dist

# Data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=5000
# data.db must live in project root (mapped via volume)

EXPOSE 5000

CMD ["node", "dist/index.cjs"]
