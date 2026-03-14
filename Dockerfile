ARG BASE_IMAGE
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy source code
COPY . .

# Create symlinks for workspace module resolution
RUN ln -sf /app/node_modules /app/packages/sdk/node_modules && \
    ln -sf /app/node_modules /app/packages/server/node_modules

# bb versions directory — host downloads bb on demand and uploads to enclave.
# In standard mode (local dev), bb is resolved via BB_BINARY_PATH or node_modules.
ENV BB_VERSIONS_DIR=/bb-versions
RUN mkdir -p /bb-versions

EXPOSE 80
ENV PORT=80
# In production, TEE_MODE=nitro activates proxy mode → forwards to enclave.
# ENCLAVE_URL points to the enclave service (via socat vsock bridge).
ENV TEE_MODE=nitro
ENV ENCLAVE_URL=http://localhost:4000

# Run as non-root user
RUN useradd --create-home --shell /bin/bash appuser && chown -R appuser:appuser /app
USER appuser

# Run the server
WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:80/health || exit 1

CMD ["bun", "run", "src/index.ts"]
