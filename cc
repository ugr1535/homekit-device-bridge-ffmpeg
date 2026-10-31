#!/bin/sh
set -eu
exec "$CAMERA_ZIG" cc -target "${CAMERA_TARGET:?Build target required}" "$@"
