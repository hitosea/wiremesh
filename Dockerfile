FROM node:20-alpine AS base

# Build Agent
FROM golang:1.25-alpine AS agent-builder
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o wiremesh-agent .

# Build Next.js
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Runtime
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/node_modules ./node_modules
COPY worker/ ./worker/

# Copy Agent binary
COPY --from=agent-builder /agent/wiremesh-agent ./public/agent/wiremesh-agent-linux-amd64

EXPOSE 3000
CMD ["sh", "-c", "node worker/index.js & node server.js"]
