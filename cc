#!/bin/sh
set -eu
exec "$CAMERA_ZIG" cc -target aarch64-linux-musl "$@"
