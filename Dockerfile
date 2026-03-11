ARG BASE_IMAGE
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy source code
COPY . .

# Create symlinks for workspace module resolution
RUN ln -sf /app/node_modules /app/packages/sdk/node_modules && \
    ln -sf /app/node_modules /app/packages/server/node_modules

# Pre-cache bb binaries (same as Dockerfile.nitro).
ARG BB_VERSIONS=""
ENV BB_VERSIONS_DIR=/bb-versions
RUN set -e && \
    mkdir -p /bb-versions && \
    if [ -n "${BB_VERSIONS}" ]; then \
      for version in $(echo "${BB_VERSIONS}" | tr ',' ' '); do \
        echo "Downloading bb v${version}..." && \
        mkdir -p "/bb-versions/${version}" && \
        curl -fSL "https://github.com/AztecProtocol/aztec-packages/releases/download/v${version}/barretenberg-amd64-linux.tar.gz" \
          | tar -xzf - -C "/bb-versions/${version}" --strip-components=0 && \
        chmod 755 "/bb-versions/${version}/bb" && \
        echo "Cached bb v${version}" ; \
      done ; \
    fi

EXPOSE 80
ENV PORT=80

# Run as non-root user
RUN useradd --create-home --shell /bin/bash appuser && chown -R appuser:appuser /app
USER appuser

# Run the server
WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:80/attestation || exit 1

CMD ["bun", "run", "src/index.ts"]
