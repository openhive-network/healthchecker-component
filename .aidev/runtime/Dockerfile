# The image AIDEV runs this project's suites in (`environment.image` in
# .aidev/project.yaml). Suites run with `--network none`, so everything an
# install needs is in the image: Node, pnpm (pinned by package.json's
# `packageManager`, installed through corepack) and a pnpm store filled from the
# lockfile. Build and pin it with .aidev/runtime/build.sh; see .aidev/README.md.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ENV HOME=/tmp \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_ENABLE_NETWORK=0 \
    npm_config_store_dir=/opt/pnpm-store \
    DO_NOT_TRACK=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /tmp/pnpm-fetch/
RUN cd /tmp/pnpm-fetch \
    && corepack enable \
    && COREPACK_ENABLE_NETWORK=1 corepack install -g "$(node -p "require('./package.json').packageManager")" \
    && pnpm fetch \
    && cd / && rm -rf /tmp/pnpm-fetch \
    && chmod -R a+rwX /opt/pnpm-store /opt/corepack
