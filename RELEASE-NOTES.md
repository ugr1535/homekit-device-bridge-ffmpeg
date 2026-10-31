Camera media component only; this is not the Homey application package.

FFmpeg 9.0.2, x264, OpenSSL and the musl/compiler runtime sources are pinned by
the included source inventory. The executable is GPL-3.0-or-later. Build recipe
licensing does not replace the executable's license.

Download the matching corresponding-source archive, binary archive, notices and
SHA256SUMS from this same release. The source archive contains upstream sources,
the actual compiler runtime sources, build scripts and dependency license texts.
The compiler program itself is not redistributed; the recipe pins its upstream
download and checksum.

Linux ARM64 tests passed for three H264 profiles, JPEG snapshots, copy-only AAC audio in fragmented MP4,
over TCP, SRTP packet output and rejection of an untrusted TLS certificate.
The tests ran against the exact executable identified in smoke-result.json.

This prerelease does not certify Homey hardware performance, Apple Home playback,
codec patent clearance or Athom approval. Perform the physical device and
endurance tests before releasing the consuming app publicly.

Keep these matching source assets accessible for as long as the executable is
distributed. Do not replace an existing asset with a different build; issue a
new version and matching source package instead. No account, password or key is
required to download the public source assets.
