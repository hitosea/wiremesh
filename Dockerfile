FROM node:20-alpine AS base

# Download Xray binaries from GitHub
FROM alpine:latest AS xray-downloader
ARG XRAY_VERSION=v26.3.27
RUN apk add --no-cache curl unzip && \
    mkdir -p /out && \
    curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" -o /tmp/xray-amd64.zip && \
    unzip -o /tmp/xray-amd64.zip xray -d /tmp/xray-amd64 && \
    tar czf /out/xray-linux-amd64.tar.gz -C /tmp/xray-amd64 xray && \
    sha256sum /out/xray-linux-amd64.tar.gz > /out/xray-linux-amd64.tar.gz.sha256 && \
    curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-arm64-v8a.zip" -o /tmp/xray-arm64.zip && \
    unzip -o /tmp/xray-arm64.zip xray -d /tmp/xray-arm64 && \
    tar czf /out/xray-linux-arm64.tar.gz -C /tmp/xray-arm64 xray && \
    sha256sum /out/xray-linux-arm64.tar.gz > /out/xray-linux-arm64.tar.gz.sha256 && \
    echo -n "${XRAY_VERSION}" > /out/xray-version.txt

# Build Agent (both architectures)
FROM golang:1.25-alpine AS agent-builder
ARG AGENT_VERSION=dev
WORKDIR /agent
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-X main.Version=${AGENT_VERSION}" -o wiremesh-agent . && \
    tar czf wiremesh-agent-linux-amd64.tar.gz wiremesh-agent && \
    sha256sum wiremesh-agent-linux-amd64.tar.gz > wiremesh-agent-linux-amd64.tar.gz.sha256 && \
    rm wiremesh-agent && \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "-X main.Version=${AGENT_VERSION}" -o wiremesh-agent . && \
    tar czf wiremesh-agent-linux-arm64.tar.gz wiremesh-agent && \
    sha256sum wiremesh-agent-linux-arm64.tar.gz > wiremesh-agent-linux-arm64.tar.gz.sha256 && \
    rm wiremesh-agent && \
    echo -n "${AGENT_VERSION}" > agent-version.txt

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

# Copy Agent binaries (both architectures, tar.gz)
COPY --from=agent-builder /agent/wiremesh-agent-linux-amd64.tar.gz ./public/agent/
COPY --from=agent-builder /agent/wiremesh-agent-linux-arm64.tar.gz ./public/agent/
COPY --from=agent-builder /agent/wiremesh-agent-linux-amd64.tar.gz.sha256 ./public/agent/
COPY --from=agent-builder /agent/wiremesh-agent-linux-arm64.tar.gz.sha256 ./public/agent/
COPY --from=agent-builder /agent/agent-version.txt ./public/agent/

# Copy Xray binaries from GitHub
COPY --from=xray-downloader /out/xray-linux-amd64.tar.gz ./public/xray/
COPY --from=xray-downloader /out/xray-linux-arm64.tar.gz ./public/xray/
COPY --from=xray-downloader /out/xray-linux-amd64.tar.gz.sha256 ./public/xray/
COPY --from=xray-downloader /out/xray-linux-arm64.tar.gz.sha256 ./public/xray/
COPY --from=xray-downloader /out/xray-version.txt ./public/xray/

EXPOSE 3000
CMD ["sh", "-c", "node worker/index.js & node server.js"]
