ARG BASE_IMAGE
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy source code
COPY . .

# Create symlinks for workspace module resolution
RUN ln -sf /app/node_modules /app/packages/sdk/node_modules && \
    ln -sf /app/node_modules /app/packages/server/node_modules

EXPOSE 80
ENV PORT=80

# Run as non-root user
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser

# Run the server
WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:80/attestation || exit 1

CMD ["bun", "run", "src/index.ts"]
