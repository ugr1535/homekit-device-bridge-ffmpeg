'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { digest, verifySources } = require('./fetch');
const lock = require('./sources.json');
const RECIPE_FILES = ['sources.json', 'fetch.js', 'build.sh', 'cc', 'ar', 'ranlib', 'strip',
    'smoke.js', 'package.js', 'README.md', 'LICENSE'];

async function packageRelease(build, archives, output) {
    await verifySources(archives);
    const smoke = JSON.parse(await fs.readFile(path.join(build, 'output/smoke-result.json'), 'utf8'));
    const binary = path.join(build, 'output/ffmpeg');
    if (smoke.status !== 'passed' || smoke.platform !== 'linux' || smoke.arch !== 'arm64'
        || smoke.binarySha256 !== await digest(binary)) throw Error('Matching ARM64 smoke report required');
    await fs.mkdir(output, { recursive: false });
    const sources = path.join(output, 'corresponding-source');
    const sourceArchives = path.join(sources, 'archives');
    await fs.mkdir(sourceArchives, { recursive: true });
    for (const file of RECIPE_FILES) await fs.copyFile(path.join(__dirname, file), path.join(sources, file));
    for (const entry of Object.values(lock.sources)) await fs.copyFile(path.join(archives, entry.file), path.join(sourceArchives, entry.file));
    // Preserve the actual compiler-supplied runtime sources as well as Zig's full
    // release source. The compiler executable itself is not redistributed.
    const runtime = path.join(sources, 'compiler-runtime-sources');
    await fs.mkdir(runtime);
    for (const file of ['lib/compiler_rt', 'lib/compiler_rt.zig', 'lib/libc/musl', 'lib/libc/include', 'lib/libunwind', 'LICENSE']) {
        await fs.cp(path.join(build, 'toolchain', file), path.join(runtime, file), { recursive: true });
    }
    const licenses = path.join(output, 'licenses');
    await fs.mkdir(licenses);
    const noticeFiles = {
        'FFmpeg-LICENSE.md': 'src/ffmpeg/LICENSE.md',
        'COPYING.GPLv3': 'src/ffmpeg/COPYING.GPLv3',
        'COPYING.GPLv2': 'src/ffmpeg/COPYING.GPLv2',
        'COPYING.LGPLv2.1': 'src/ffmpeg/COPYING.LGPLv2.1',
        'COPYING.LGPLv3': 'src/ffmpeg/COPYING.LGPLv3',
        'x264-COPYING': 'src/x264/COPYING', 'x264-AUTHORS': 'src/x264/AUTHORS',
        'OpenSSL-LICENSE.txt': 'src/openssl/LICENSE.txt',
        'musl-COPYRIGHT': 'toolchain/lib/libc/musl/COPYRIGHT',
        'Zig-LICENSE': 'toolchain/LICENSE', 'libunwind-LICENSE.txt': 'toolchain/lib/libunwind/LICENSE.TXT',
        'IJG-jfdctfst.c': 'src/ffmpeg/libavcodec/jfdctfst.c',
        'IJG-jfdctint_template.c': 'src/ffmpeg/libavcodec/jfdctint_template.c',
        'IJG-jrevdct.c': 'src/ffmpeg/libavcodec/jrevdct.c'
    };
    for (const [name, file] of Object.entries(noticeFiles)) await fs.copyFile(path.join(build, file), path.join(licenses, name));
    const notices = `# Camera FFmpeg Third-Party Notices\n\nFFmpeg ${lock.sources.ffmpeg.version} with libx264 is distributed under GPL-3.0-or-later.\n` +
        `libx264 ${lock.sources.x264.version} is GPL-2.0-or-later. OpenSSL ${lock.sources.openssl.version} is Apache-2.0.\n` +
        'The musl, Zig and compiler runtime components retain their upstream licenses; see licenses/ and the corresponding-source archive.\n\n' +
        'This software is based in part on the work of the Independent JPEG Group.\n' +
        'The original IJG-derived FFmpeg source files are included with their notices. No upstream source files were modified for this build.\n\n' +
        'The build recipes are ISC-licensed; that does not relicense the media executable.\n' +
        'Complete corresponding-source archives and build instructions are available without authentication at:\n' +
        'https://github.com/ugr1535/homekit-device-bridge-ffmpeg/releases\n\n' +
        'Use the release matching the binary SHA-256 in build-manifest.json. No Homey application code or credentials are included.\n';
    await fs.writeFile(path.join(output, 'THIRD_PARTY_NOTICES.md'), notices);
    await fs.cp(licenses, path.join(sources, 'licenses'), { recursive: true });
    await fs.writeFile(path.join(sources, 'THIRD_PARTY_NOTICES.md'), notices);
    for (const name of ['config.h', 'config_components.h', 'config.mak', 'smoke-result.json']) {
        await fs.copyFile(path.join(build, 'output', name), path.join(sources, name));
    }
    const archiveName = `${lock.release}-corresponding-source.tar.gz`;
    execFileSync('tar', ['-czf', path.join(output, archiveName), '-C', output, 'corresponding-source'], { timeout: 120000 });
    await fs.rm(sources, { recursive: true });
    await fs.copyFile(binary, path.join(output, 'ffmpeg'));
    await fs.chmod(path.join(output, 'ffmpeg'), 0o755);
    await fs.copyFile(path.join(build, 'output/smoke-result.json'), path.join(output, 'smoke-result.json'));
    const manifest = { schemaVersion: 1, release: lock.release, version: '9.0.2',
        license: 'GPL-3.0-or-later', variant: 'linuxarm64-gpl-minimal-musl', linkage: 'fully-static',
        platform: 'linux', arch: 'arm64', sourceRepository: 'https://github.com/ugr1535/homekit-device-bridge-ffmpeg',
        correspondingSource: { file: archiveName, sha256: await digest(path.join(output, archiveName)) },
        sources: lock.sources, smoke, files: {} };
    for (const name of ['ffmpeg', archiveName, 'smoke-result.json', 'THIRD_PARTY_NOTICES.md']) {
        manifest.files[name] = { sha256: await digest(path.join(output, name)), bytes: (await fs.stat(path.join(output, name))).size };
    }
    for (const name of Object.keys(noticeFiles)) {
        const file = `licenses/${name}`;
        manifest.files[file] = { sha256: await digest(path.join(output, file)), bytes: (await fs.stat(path.join(output, file))).size };
    }
    await fs.writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const sums = [];
    for (const name of [...Object.keys(manifest.files), 'build-manifest.json']) sums.push(`${await digest(path.join(output, name))}  ${name}`);
    await fs.writeFile(path.join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
    const binaryArchive = `${lock.release}-linux-arm64.tar.gz`;
    execFileSync('tar', ['-czf', path.join(output, binaryArchive), '-C', output,
        'ffmpeg', 'licenses', 'THIRD_PARTY_NOTICES.md', 'build-manifest.json', 'smoke-result.json', 'SHA256SUMS'], { timeout: 120000 });
    console.log(JSON.stringify({ output, binaryBytes: manifest.files.ffmpeg.bytes, sourceBytes: manifest.files[archiveName].bytes }));
    return manifest;
}

if (require.main === module) packageRelease(...process.argv.slice(2).map(value => path.resolve(value)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { packageRelease, RECIPE_FILES };
