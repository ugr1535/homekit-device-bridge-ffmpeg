#!/bin/sh
set -eu

# Offline after fetch.js: never install a compiler or mutate the app bundle here.
RECIPE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORK=${1:?Provide a separate empty build directory}
ARCHIVES=${2:?Provide the checksum-verified archive directory}
case "$WORK$ARCHIVES$RECIPE" in *' '*|*'\n'*) echo 'Use build paths without spaces' >&2; exit 1;; esac
node "$RECIPE/fetch.js" --verify "$ARCHIVES"
test ! -e "$WORK" || { echo 'Build directory already exists; use a new directory' >&2; exit 1; }
mkdir -p "$WORK/src" "$WORK/toolchain" "$WORK/bin" "$WORK/prefix"
WORK=$(CDPATH= cd -- "$WORK" && pwd)
ARCHIVES=$(CDPATH= cd -- "$ARCHIVES" && pwd)
export CAMERA_ZIG="$WORK/toolchain/zig"
export ZIG_GLOBAL_CACHE_DIR="$WORK/cache"
export ZIG_LOCAL_CACHE_DIR="$WORK/local-cache"
export SOURCE_DATE_EPOCH=1790812800
export LC_ALL=C TZ=UTC
export CC="$WORK/bin/cc" AR="$WORK/bin/ar" RANLIB="$WORK/bin/ranlib" STRIP="$WORK/bin/strip"
export CFLAGS="-O2 -fPIC -fstack-protector-strong -ffile-prefix-map=$WORK=/build"
export LDFLAGS="-static -pie -Wl,-z,relro,-z,now,-z,noexecstack"
export PKG_CONFIG_LIBDIR="$WORK/prefix/lib/pkgconfig"
unset PKG_CONFIG_PATH CPATH LIBRARY_PATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH SDKROOT
for tool in cc ar ranlib strip; do cp "$RECIPE/$tool" "$WORK/bin/$tool"; chmod 755 "$WORK/bin/$tool"; done
HOST=$(node -p 'process.platform+"-"+process.arch')
TOOLCHAIN=$(node -e 'console.log(require(process.argv[1]).toolchains[process.argv[2]].file)' "$RECIPE/sources.json" "$HOST")
tar -xf "$ARCHIVES/$TOOLCHAIN" -C "$WORK/toolchain" --strip-components=1
for component in ffmpeg x264 openssl; do
    archive=$(node -e 'console.log(require(process.argv[1]).sources[process.argv[2]].file)' "$RECIPE/sources.json" "$component")
    expected=$(node -e 'console.log(require(process.argv[1]).sources[process.argv[2]].sha256)' "$RECIPE/sources.json" "$component")
    actual=$(node -e 'require(process.argv[1]).digest(process.argv[2]).then(console.log)' "$RECIPE/fetch.js" "$ARCHIVES/$archive")
    test "$actual" = "$expected" || { echo "Checksum mismatch: $component" >&2; exit 1; }
    mkdir "$WORK/src/$component"
    tar -xf "$ARCHIVES/$archive" -C "$WORK/src/$component" --strip-components=1
done
JOBS=${JOBS:-2}
case "$JOBS" in 1|2|3|4) ;; *) echo 'JOBS must be 1-4' >&2; exit 1;; esac
cd "$WORK/src/x264"
./configure --host=aarch64-linux --prefix="$WORK/prefix" --enable-static --disable-cli --disable-opencl --enable-pic --bit-depth=8 --chroma-format=420
make -j"$JOBS"
make install-lib-static install-lib-dev
cd "$WORK/src/openssl"
perl Configure linux-aarch64 --prefix="$WORK/prefix" --openssldir=/etc/ssl --libdir=lib \
    no-shared no-tests no-apps no-docs no-module no-engine no-legacy no-comp no-dso no-zlib
make -j"$JOBS" build_libs
make install_dev
cd "$WORK/src/ffmpeg"
NM=$(command -v llvm-nm || true)
if test -z "$NM" && test "$(uname -s)" = Darwin; then NM=$(xcrun --find llvm-nm); fi
test -n "$NM" || NM=nm
./configure --prefix="$WORK/prefix" --enable-cross-compile --target-os=linux --arch=aarch64 --cpu=generic \
    --cc="$CC" --ar="$AR" --ranlib="$RANLIB" --strip="$STRIP" --nm="$NM" \
    --pkg-config=pkg-config --pkg-config-flags=--static \
    --extra-cflags="$CFLAGS -I$WORK/prefix/include" --extra-ldflags="$LDFLAGS -L$WORK/prefix/lib" \
    --disable-autodetect --disable-debug --disable-doc --disable-shared --disable-stripping --enable-static --enable-pic \
    --disable-everything --disable-ffplay --disable-ffprobe --disable-swresample \
    --enable-ffmpeg --enable-network --enable-pthreads --enable-gpl --enable-version3 --enable-libx264 --enable-openssl \
    --enable-protocol=file,pipe,tcp,udp,rtp,srtp,crypto,tls \
    --enable-demuxer=rtsp,rtp,sdp,h264,mov --enable-indev=lavfi \
    --enable-muxer=rtp,h264,mp4,image2,image2pipe,null \
    --enable-decoder=h264,mjpeg,wrapped_avframe --enable-encoder=libx264,mjpeg,wrapped_avframe \
    --enable-parser=h264 --enable-bsf=h264_mp4toannexb,dump_extradata,extract_extradata \
    --enable-filter=color,scale,pad,setsar,fps,format,null,split
for feature in H264_MP4TOANNEXB_BSF DUMP_EXTRADATA_BSF WRAPPED_AVFRAME_DECODER TLS_PROTOCOL SRTP_PROTOCOL RTSP_DEMUXER LIBX264_ENCODER MJPEG_ENCODER MP4_MUXER; do
    grep -q "^#define CONFIG_${feature} 1$" config_components.h || { echo "Missing build feature: $feature" >&2; exit 1; }
done
make -j"$JOBS" ffmpeg
mkdir "$WORK/output"
cp ffmpeg "$WORK/output/ffmpeg"
if test "$HOST" = linux-arm64; then strip --strip-all "$WORK/output/ffmpeg"; fi
chmod 755 "$WORK/output/ffmpeg"
cp config.h config_components.h ffbuild/config.mak "$WORK/output/"
printf '%s\n' "Built $WORK/output/ffmpeg; target-device validation is still required."
