# HomeKit Device Bridge: Camera FFmpeg Sources

This repository contains only the build tools, source inventory and notices for
the separate FFmpeg camera executable. It does not contain the Homey bridge
application, camera addresses, account credentials or HomeKit pairing data.

The build recipe is ISC-licensed; the resulting FFmpeg executable is GPL-3.0-or-later.
FFmpeg, x264, OpenSSL and the Zig-provided runtime sources retain their respective
upstream licenses and copyright notices. See each source archive and the notices
shipped with each binary release. Build-tool licensing does not relicense FFmpeg.

## Releases and Corresponding Source

Each published binary release must have its matching corresponding-source archive,
source lock, build recipe, notices, SHA-256 checksums and target-platform smoke
report. Download the source archive from the same release as the binary, not an
unrelated current branch. No published release means no approved binary yet.
Sources can be downloaded without signing in or supplying a key.

## Build

Prerequisites: Node.js 18+, POSIX shell, make, Perl, tar and pkg-config; x64 builds
also require NASM to retain optimized x86 code. On macOS,
Apple Command Line Tools provide llvm-nm. Linux build hosts need binutils.
Supported hosts are macOS ARM64, Linux ARM64 and Linux x64; targets are Linux
ARM64 and Linux x64 static PIE with a musl runtime, stack protection, RELRO and a
non-executable stack. The prebuilt Zig toolchain is
checksum-pinned and unpacked locally; nothing is installed globally.

```sh
node fetch.js /tmp/camera-archives
sh build.sh /tmp/camera-build /tmp/camera-archives
# For Linux x64 output instead:
CAMERA_ARCH=x64 sh build.sh /tmp/camera-build-x64 /tmp/camera-archives
```

Use fresh build/output directories. JOBS is bounded to 1-4 (default 2). To build
offline, unpack the matching corresponding-source archive, use its recipe and
archives directory and ensure the checksum-pinned toolchain for your host is
present. fetch.js can retrieve a missing host toolchain from its pinned URL.
The compiler executable is not redistributed. Fetch its checksum-pinned archive
before an offline build. The bundle includes Zig's full source archive and the
actual compiler-supplied runtime sources, including musl and compiler-rt.

On a Linux host matching the built executable's architecture, run:

```sh
node smoke.js /tmp/camera-build/output/ffmpeg /tmp/camera-smoke
node package.js /tmp/camera-build /tmp/camera-archives /tmp/camera-release
```

The automated tests check three actual H264 profiles, JPEG output, fragmented MP4
over loopback TCP and SRTP packet output. They do not certify Apple Home playback,
Homey hardware resource use, codec patent clearance or App Store acceptance.

Features are intentionally limited to H264 video, JPEG snapshots, MP4 recording,
RTSP input, SRTP output, copy-only AAC-LC audio and TLS. Audio encoders, ffprobe, ffplay, FDK-AAC, OpenCL and unrelated
external codec libraries are not enabled. libx264 remains included: this is not
an LGPL-only build. Inputs are not patched; source hashes and build options are
recorded. Cross-platform symbol stripping is disabled; native Linux ARM64 builds
strip the final executable with the host's binutils after linking.
Exact binary hashes may differ across host environments; every distributed
binary must be accompanied by the source/build record for that build.
Each architecture has separate binary/source archives, SHA-256 digests and a
native smoke report. CI uses native ARM64 and x64 hosts, not CPU emulation.
CI restores the original upstream archives from an earlier immutable public
source release, checking its full SHA-256 before extraction. fetch.js then checks
each individual source hash and retrieves the host toolchain. This avoids making
every rebuild depend on the upstream FFmpeg download server being reachable.
These are Linux executables, not macOS Mach-O applications. A Mac's CPU alone
does not prove compatibility; verify the Homey app process's platform/architecture
and LAN reachability in its actual Self-Hosted Server environment.

For modified versions, edit the source/recipe, rebuild in a new directory and
substitute the executable in a local development copy of the consuming app.
Retain the license/source obligations for any redistributed modified build.
Do not overwrite production pairings or uninstall the Homey app to test a build.
