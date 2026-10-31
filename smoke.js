'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSocket } = require('node:dgram');
const { createServer } = require('node:net');
const { createServer: createTlsServer } = require('node:tls');
const { randomBytes, createHash } = require('node:crypto');
const execute = promisify(execFile);

async function smoke(binary, directory) {
    assert.equal(process.platform, 'linux');
    assert.equal(process.arch, 'arm64');
    await fs.mkdir(directory, { recursive: true });
    const run = async args => (await execute(binary, ['-hide_banner', '-nostdin', ...args],
        { timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' })).stdout;
    assert.match((await run(['-version'])).toString(), /ffmpeg version 9\.0\.2/);
    assert.match((await run(['-L'])).toString(), /GNU General Public License/);
    const protocols = (await run(['-protocols'])).toString();
    for (const protocol of ['tcp', 'udp', 'srtp', 'tls', 'file', 'pipe']) assert.match(protocols, new RegExp(`\\b${protocol}\\b`));
    assert.match((await run(['-demuxers'])).toString(), /\bD\s+rtsp\s/);
    const encodedProfiles = [];
    for (const [profile, expected, cabac, dct] of [['baseline', 66, 0, 0], ['main', 77, 1, 0], ['high', 100, 1, 1]]) {
        const h264 = await run(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=480x640:r=30',
            '-frames:v', '1', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-threads', '1',
            '-profile:v', profile, '-level:v', '3.1', '-pix_fmt', 'yuv420p', '-vf',
            'fps=30,scale=540:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=540:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
            '-x264-params', `cabac=${cabac}:8x8dct=${dct}`, '-f', 'h264', 'pipe:1']);
        let actual;
        for (let i = 0; i + 6 < h264.length; i++) {
            if (h264[i] === 0 && h264[i + 1] === 0 && h264[i + 2] === 1 && (h264[i + 3] & 31) === 7) { actual = h264[i + 4]; break; }
        }
        assert.equal(actual, expected, `Actual encoded ${profile} profile`);
        encodedProfiles.push(profile);
    }
    const fixture = path.join(directory, 'fixture.mp4');
    await run(['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=24', '-t', '3', '-an',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-g', '24', '-sc_threshold', '0', '-y', fixture]);
    const jpeg = await run(['-loglevel', 'error', '-i', fixture, '-frames:v', '1', '-vf', 'scale=640:360',
        '-threads', '1', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1']);
    assert.equal(jpeg.readUInt16BE(0), 0xffd8);
    assert.equal(jpeg.readUInt16BE(jpeg.length - 2), 0xffd9);
    let mp4Bytes = 0;
    const listener = createServer(socket => socket.on('data', chunk => { mp4Bytes += chunk.length; }));
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    try {
        await run(['-loglevel', 'error', '-i', fixture, '-an', '-c:v', 'copy', '-movflags',
            'frag_keyframe+empty_moov+default_base_moof+skip_trailer', '-f', 'mp4', `tcp://127.0.0.1:${listener.address().port}`]);
        assert.ok(mp4Bytes > 1000);
    } finally { await new Promise(resolve => listener.close(resolve)); }
    const socket = createSocket('udp4');
    let srtpPackets = 0;
    socket.on('message', () => { srtpPackets++; });
    await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
    try {
        const port = socket.address().port;
        await run(['-loglevel', 'error', '-i', fixture, '-an', '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb,dump_extra',
            '-payload_type', '96', '-ssrc', '12345', '-f', 'rtp', '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', randomBytes(30).toString('base64'), `srtp://127.0.0.1:${port}?rtcpport=${port}&pkt_size=1316`]);
        assert.ok(srtpPackets > 0);
    } finally { socket.close(); }
    const key = path.join(directory, 'tls-key.pem');
    const cert = path.join(directory, 'tls-cert.pem');
    await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
        '-days', '1', '-subj', '/CN=localhost'], { timeout: 10000 });
    const tls = createTlsServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) });
    tls.on('tlsClientError', () => {});
    await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
    try {
        await assert.rejects(run(['-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '2000000', '-tls_verify', '1',
            '-i', `rtsps://127.0.0.1:${tls.address().port}/test`, '-an', '-c:v', 'copy', '-f', 'null', '-']),
        error => /certificate verify failed/i.test(String(error.stderr)));
    } finally { await new Promise(resolve => tls.close(resolve)); }
    const data = await fs.readFile(binary);
    assert.equal(data.readUInt16LE(16), 3, 'Static PIE is required to retain address randomization');
    const offset = Number(data.readBigUInt64LE(32)), size = data.readUInt16LE(54), count = data.readUInt16LE(56);
    let nonExecutableStack = false, relro = false;
    for (let i = 0; i < count; i++) {
        const at = offset + i * size, type = data.readUInt32LE(at), flags = data.readUInt32LE(at + 4);
        if (type === 0x6474e551) nonExecutableStack = !(flags & 1);
        if (type === 0x6474e552) relro = true;
        assert.notEqual(type, 3, 'No external ELF loader');
    }
    assert.ok(nonExecutableStack && relro, 'NX stack and RELRO are required');
    const report = { schemaVersion: 1, platform: process.platform, arch: process.arch,
        binarySha256: createHash('sha256').update(data).digest('hex'), binaryBytes: data.length,
        encodedProfiles, jpeg: true, fragmentedMp4Tcp: true, srtpPackets, tlsRejectsUntrusted: true, status: 'passed',
        staticPie: true, nonExecutableStack, relro,
        homeyHardwareTested: false, appleHomePlaybackTested: false };
    await fs.writeFile(path.join(path.dirname(binary), 'smoke-result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) smoke(path.resolve(process.argv[2]), path.resolve(process.argv[3]))
    .catch(error => { console.error(String(error.stderr || error.message).slice(-2000)); process.exitCode = 1; });

module.exports = { smoke };
