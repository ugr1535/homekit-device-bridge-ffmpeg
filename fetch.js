'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const lock = require('./sources.json');

async function digest(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

async function fetchSources(directory) {
    const toolchain = lock.toolchains[`${process.platform}-${process.arch}`];
    if (!toolchain) throw Error('Unsupported build host');
    await fs.promises.mkdir(directory, { recursive: true });
    for (const entry of [...Object.values(lock.sources), toolchain]) {
        const file = path.join(directory, entry.file);
        if (fs.existsSync(file) && await digest(file) === entry.sha256) { console.log(`Verified ${entry.file}`); continue; }
        const stage = `${file}.partial`;
        try {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    console.log(`Downloading ${entry.file} (attempt ${attempt + 1}/3)`);
                    const response = await fetch(entry.url, { signal: AbortSignal.timeout(240000) });
                    if (!response.ok || new URL(response.url).protocol !== 'https:') throw Error('Source response unavailable');
                    let bytes = 0;
                    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, done) {
                        bytes += chunk.length;
                        done(bytes > 128 * 1024 * 1024 ? Error('Source archive too large') : null, chunk);
                    } }), fs.createWriteStream(stage));
                    break;
                } catch (error) {
                    if (attempt === 2 || error.message === 'Source archive too large') throw Error(`Source download failed: ${entry.file}`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                }
            }
            if (await digest(stage) !== entry.sha256) throw Error(`Source checksum mismatch: ${entry.file}`);
            await fs.promises.rename(stage, file);
            console.log(`Verified ${entry.file}`);
        } finally { await fs.promises.rm(stage, { force: true }); }
    }
}

async function verifySources(directory) {
    const toolchain = lock.toolchains[`${process.platform}-${process.arch}`];
    if (!toolchain) throw Error('Unsupported build host');
    for (const entry of [...Object.values(lock.sources), toolchain]) {
        if (await digest(path.join(directory, entry.file)) !== entry.sha256) throw Error(`Source checksum mismatch: ${entry.file}`);
    }
}

if (require.main === module) {
    const verify = process.argv[2] === '--verify';
    const directory = process.argv[verify ? 3 : 2];
    (directory ? (verify ? verifySources : fetchSources)(path.resolve(directory)) : Promise.reject(Error('Provide an archive cache directory')))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { digest, fetchSources, verifySources };
