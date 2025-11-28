# Build stage
FROM node:18-alpine AS builder

WORKDIR /app


# Install dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src/database/schema.sql ./dist/database/schema.sql

# Create non-root user
RUN addgroup -g 1001 -S nostr && \
    adduser -S nostr -u 1001

USER nostr

# Expose API port
EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["node", "dist/api-server.js"]
