FROM oven/bun:1.3-debian

# system dependencies for native modules
RUN apt update && apt install -y git build-essential libc++-dev python3 curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace config first for layer caching
COPY package.json bun.lock ./
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/server/package.json ./packages/server/
COPY packages/app/package.json ./packages/app/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Create symlinks for workspace module resolution
RUN ln -sf /app/node_modules /app/packages/sdk/node_modules && \
    ln -sf /app/node_modules /app/packages/server/node_modules

EXPOSE 80
ENV PORT=80

# Run the server
WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:80/attestation || exit 1

CMD ["bun", "run", "src/index.ts"]
