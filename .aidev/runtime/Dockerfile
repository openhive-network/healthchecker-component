# The image AIDEV runs this project's suites in (`environment.image` in
# .aidev/project.yaml). Suites run with `--network none`, so everything an
# install needs is in the image: Node and pnpm from common-ci-configuration's
# node-test-tools image, the one CI runs (this file pins no tool version), and a
# pnpm store filled from the lockfile. Build and pin it with
# .aidev/runtime/build.sh, which builds on the digest node-test-tools:develop
# names at the time; see .aidev/README.md.
ARG BASE_IMAGE=registry.gitlab.syncad.com/hive/common-ci-configuration/node-test-tools:develop
FROM ${BASE_IMAGE}

# pnpm must not switch to `packageManager`'s version: that would download at run
# time, offline.
ENV HOME=/tmp \
    npm_config_store_dir=/opt/pnpm-store \
    npm_config_manage_package_manager_versions=false \
    DO_NOT_TRACK=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /tmp/pnpm-fetch/
RUN cd /tmp/pnpm-fetch \
    && pnpm fetch \
    && cd / && rm -rf /tmp/pnpm-fetch \
    && chmod -R a+rwX /opt/pnpm-store
