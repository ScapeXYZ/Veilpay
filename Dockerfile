# syntax=docker/dockerfile:1

# Compile Axum independently so the runtime image contains no Rust toolchain,
# Cargo cache, source, wallet material, or build-only packages.
FROM rust:1.89-bookworm AS backend-build
WORKDIR /build
COPY backend/Cargo.toml backend/Cargo.lock ./backend/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/backend/target \
    mkdir -p backend/src && printf 'fn main() {}\n' > backend/src/main.rs && cargo build --release --locked --manifest-path backend/Cargo.toml
COPY backend ./backend
# transport.rs verifies these exact, repository-tracked patch bytes at compile
# time via include_bytes!(), resolved relative to /build/backend/src.
COPY scripts/patches ./scripts/patches/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/backend/target \
    cargo build --release --locked --manifest-path backend/Cargo.toml \
    && install -Dm0555 backend/target/release/veilpay-backend /build/veilpay-backend

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* values are intentionally fixed at build time. Server-only
# deployment settings are checked again by the runtime entrypoint.
ENV NEXT_PUBLIC_API_MODE=live \
    VEILPAY_PUBLIC_DEPLOYMENT=1 \
    VEILPAY_BACKEND_URL=http://127.0.0.1:4100/api \
    VEILPAY_DEPLOYMENT_NETWORK=testnet
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=10000 \
    HOSTNAME=0.0.0.0 \
    BIND_ADDR=127.0.0.1:4100 \
    DATABASE_URL=sqlite:///tmp/veilpay/veilpay-testnet.db \
    VEILPAY_PUBLIC_DEPLOYMENT=1 \
    VEILPAY_BACKEND_URL=http://127.0.0.1:4100/api

RUN groupadd --system --gid 10001 veilpay \
    && useradd --system --uid 10001 --gid veilpay --home-dir /app --no-create-home veilpay \
    && install -d --owner=10001 --group=10001 --mode=0700 /tmp/veilpay \
    && mkdir -p /app/frontend/.next \
    && chown -R veilpay:veilpay /app

COPY --from=backend-build /build/veilpay-backend /app/veilpay-backend
COPY --from=frontend-build /build/.next/standalone/ /app/frontend/
COPY --from=frontend-build /build/.next/static/ /app/frontend/.next/static/
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chown veilpay:veilpay /app/veilpay-backend /app/docker-entrypoint.sh \
    && chmod 0555 /app/veilpay-backend /app/docker-entrypoint.sh

# Regression check: the same unprivileged user that runs the service must be
# able to create the private, disposable SQLite database directory.
USER 10001:10001
RUN test "$(id -u)" -eq 10001 \
    && test -d /tmp/veilpay \
    && test -w /tmp/veilpay \
    && touch /tmp/veilpay/.write-check \
    && rm /tmp/veilpay/.write-check
EXPOSE 10000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
