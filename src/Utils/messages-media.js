var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import { Boom } from '@hapi/boom';
import { exec } from 'child_process';
import * as Crypto from 'crypto';
import { once } from 'events';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable, Transform } from 'stream';
import { URL } from 'url';
import { proto } from '../../WAProto/index.js';
import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP } from '../Defaults';
import { getBinaryNodeChild, getBinaryNodeChildBuffer, jidNormalizedUser } from '../WABinary';
import { aesDecryptGCM, aesEncryptGCM, hkdf } from './crypto';
import { generateMessageIDV2 } from './generics';
const getTmpFilesDirectory = () => tmpdir();
const getImageProcessingLibrary = () => __awaiter(void 0, void 0, void 0, function* () {
    //@ts-ignore
    const [jimp, sharp] = yield Promise.all([import('jimp').catch(() => { }), import('sharp').catch(() => { })]);
    if (sharp) {
        return { sharp };
    }
    if (jimp) {
        return { jimp };
    }
    throw new Boom('No image processing library available');
});
export const hkdfInfoKey = (type) => {
    const hkdfInfo = MEDIA_HKDF_KEY_MAPPING[type];
    return `WhatsApp ${hkdfInfo} Keys`;
};
export const getRawMediaUploadData = (media, mediaType, logger) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, e_1, _b, _c;
    const { stream } = yield getStream(media);
    logger === null || logger === void 0 ? void 0 : logger.debug('got stream for raw upload');
    const hasher = Crypto.createHash('sha256');
    const filePath = join(tmpdir(), mediaType + generateMessageIDV2());
    const fileWriteStream = createWriteStream(filePath);
    let fileLength = 0;
    try {
        try {
            for (var _d = true, stream_1 = __asyncValues(stream), stream_1_1; stream_1_1 = yield stream_1.next(), _a = stream_1_1.done, !_a; _d = true) {
                _c = stream_1_1.value;
                _d = false;
                const data = _c;
                fileLength += data.length;
                hasher.update(data);
                if (!fileWriteStream.write(data)) {
                    yield once(fileWriteStream, 'drain');
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = stream_1.return)) yield _b.call(stream_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        fileWriteStream.end();
        yield once(fileWriteStream, 'finish');
        stream.destroy();
        const fileSha256 = hasher.digest();
        logger === null || logger === void 0 ? void 0 : logger.debug('hashed data for raw upload');
        return {
            filePath: filePath,
            fileSha256,
            fileLength
        };
    }
    catch (error) {
        fileWriteStream.destroy();
        stream.destroy();
        try {
            yield fs.unlink(filePath);
        }
        catch (_e) {
            //
        }
        throw error;
    }
});
/** generates all the keys required to encrypt/decrypt & sign a media message */
export function getMediaKeys(buffer, mediaType) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!buffer) {
            throw new Boom('Cannot derive from empty media key');
        }
        if (typeof buffer === 'string') {
            buffer = Buffer.from(buffer.replace('data:;base64,', ''), 'base64');
        }
        // expand using HKDF to 112 bytes, also pass in the relevant app info
        const expandedMediaKey = hkdf(buffer, 112, { info: hkdfInfoKey(mediaType) });
        return {
            iv: expandedMediaKey.slice(0, 16),
            cipherKey: expandedMediaKey.slice(16, 48),
            macKey: expandedMediaKey.slice(48, 80)
        };
    });
}
/** Extracts video thumb using FFMPEG */
const extractVideoThumb = (path, destPath, time, size) => __awaiter(void 0, void 0, void 0, function* () {
    return new Promise((resolve, reject) => {
        const cmd = `ffmpeg -ss ${time} -i ${path} -y -vf scale=${size.width}:-1 -vframes 1 -f image2 ${destPath}`;
        exec(cmd, err => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
});
export const extractImageThumb = (bufferOrFilePath_1, ...args_1) => __awaiter(void 0, [bufferOrFilePath_1, ...args_1], void 0, function* (bufferOrFilePath, width = 32) {
    var _a, _b;
    // TODO: Move entirely to sharp, removing jimp as it supports readable streams
    // This will have positive speed and performance impacts as well as minimizing RAM usage.
    if (bufferOrFilePath instanceof Readable) {
        bufferOrFilePath = yield toBuffer(bufferOrFilePath);
    }
    const lib = yield getImageProcessingLibrary();
    if ('sharp' in lib && typeof ((_a = lib.sharp) === null || _a === void 0 ? void 0 : _a.default) === 'function') {
        const img = lib.sharp.default(bufferOrFilePath);
        const dimensions = yield img.metadata();
        const buffer = yield img.resize(width).jpeg({ quality: 50 }).toBuffer();
        return {
            buffer,
            original: {
                width: dimensions.width,
                height: dimensions.height
            }
        };
    }
    else if ('jimp' in lib && typeof ((_b = lib.jimp) === null || _b === void 0 ? void 0 : _b.Jimp) === 'object') {
        const jimp = yield lib.jimp.Jimp.read(bufferOrFilePath);
        const dimensions = {
            width: jimp.width,
            height: jimp.height
        };
        const buffer = yield jimp
            .resize({ w: width, mode: lib.jimp.ResizeStrategy.BILINEAR })
            .getBuffer('image/jpeg', { quality: 50 });
        return {
            buffer,
            original: dimensions
        };
    }
    else {
        throw new Boom('No image processing library available');
    }
});
export const encodeBase64EncodedStringForUpload = (b64) => encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/\=+$/, ''));
export const generateProfilePicture = (mediaUpload, dimensions) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    let buffer;
    const { width: w = 640, height: h = 640 } = dimensions || {};
    if (Buffer.isBuffer(mediaUpload)) {
        buffer = mediaUpload;
    }
    else {
        // Use getStream to handle all WAMediaUpload types (Buffer, Stream, URL)
        const { stream } = yield getStream(mediaUpload);
        // Convert the resulting stream to a buffer
        buffer = yield toBuffer(stream);
    }
    const lib = yield getImageProcessingLibrary();
    let img;
    if ('sharp' in lib && typeof ((_a = lib.sharp) === null || _a === void 0 ? void 0 : _a.default) === 'function') {
        img = lib.sharp
            .default(buffer)
            .resize(w, h)
            .jpeg({
            quality: 50
        })
            .toBuffer();
    }
    else if ('jimp' in lib && typeof ((_b = lib.jimp) === null || _b === void 0 ? void 0 : _b.Jimp) === 'function') {
        const jimp = yield lib.jimp.Jimp.read(buffer);
        const min = Math.min(jimp.width, jimp.height);
        const cropped = jimp.crop({ x: 0, y: 0, w: min, h: min });
        img = cropped.resize({ w, h, mode: lib.jimp.ResizeStrategy.BILINEAR }).getBuffer('image/jpeg', { quality: 50 });
    }
    else {
        throw new Boom('No image processing library available');
    }
    return {
        img: yield img
    };
});
/** gets the SHA256 of the given media message */
export const mediaMessageSHA256B64 = (message) => {
    const media = Object.values(message)[0];
    return (media === null || media === void 0 ? void 0 : media.fileSha256) && Buffer.from(media.fileSha256).toString('base64');
};
export function getAudioDuration(buffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const musicMetadata = yield import('music-metadata');
        let metadata;
        const options = {
            duration: true
        };
        if (Buffer.isBuffer(buffer)) {
            metadata = yield musicMetadata.parseBuffer(buffer, undefined, options);
        }
        else if (typeof buffer === 'string') {
            metadata = yield musicMetadata.parseFile(buffer, options);
        }
        else {
            metadata = yield musicMetadata.parseStream(buffer, undefined, options);
        }
        return metadata.format.duration;
    });
}
/**
  referenced from and modifying https://github.com/wppconnect-team/wa-js/blob/main/src/chat/functions/prepareAudioWaveform.ts
 */
export function getAudioWaveform(buffer, logger) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // @ts-ignore
            const { default: decoder } = yield import('audio-decode');
            let audioData;
            if (Buffer.isBuffer(buffer)) {
                audioData = buffer;
            }
            else if (typeof buffer === 'string') {
                const rStream = createReadStream(buffer);
                audioData = yield toBuffer(rStream);
            }
            else {
                audioData = yield toBuffer(buffer);
            }
            const audioBuffer = yield decoder(audioData);
            const rawData = audioBuffer.getChannelData(0); // We only need to work with one channel of data
            const samples = 64; // Number of samples we want to have in our final data set
            const blockSize = Math.floor(rawData.length / samples); // the number of samples in each subdivision
            const filteredData = [];
            for (let i = 0; i < samples; i++) {
                const blockStart = blockSize * i; // the location of the first sample in the block
                let sum = 0;
                for (let j = 0; j < blockSize; j++) {
                    sum = sum + Math.abs(rawData[blockStart + j]); // find the sum of all the samples in the block
                }
                filteredData.push(sum / blockSize); // divide the sum by the block size to get the average
            }
            // This guarantees that the largest data point will be set to 1, and the rest of the data will scale proportionally.
            const multiplier = Math.pow(Math.max(...filteredData), -1);
            const normalizedData = filteredData.map(n => n * multiplier);
            // Generate waveform like WhatsApp
            const waveform = new Uint8Array(normalizedData.map(n => Math.floor(100 * n)));
            return waveform;
        }
        catch (e) {
            logger === null || logger === void 0 ? void 0 : logger.debug('Failed to generate waveform: ' + e);
        }
    });
}
export const toReadable = (buffer) => {
    const readable = new Readable({ read: () => { } });
    readable.push(buffer);
    readable.push(null);
    return readable;
};
export const toBuffer = (stream) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, stream_2, stream_2_1;
    var _b, e_2, _c, _d;
    const chunks = [];
    try {
        for (_a = true, stream_2 = __asyncValues(stream); stream_2_1 = yield stream_2.next(), _b = stream_2_1.done, !_b; _a = true) {
            _d = stream_2_1.value;
            _a = false;
            const chunk = _d;
            chunks.push(chunk);
        }
    }
    catch (e_2_1) { e_2 = { error: e_2_1 }; }
    finally {
        try {
            if (!_a && !_b && (_c = stream_2.return)) yield _c.call(stream_2);
        }
        finally { if (e_2) throw e_2.error; }
    }
    stream.destroy();
    return Buffer.concat(chunks);
});
export const getStream = (item, opts) => __awaiter(void 0, void 0, void 0, function* () {
    if (Buffer.isBuffer(item)) {
        return { stream: toReadable(item), type: 'buffer' };
    }
    if ('stream' in item) {
        return { stream: item.stream, type: 'readable' };
    }
    const urlStr = item.url.toString();
    if (urlStr.startsWith('data:')) {
        const buffer = Buffer.from(urlStr.split(',')[1], 'base64');
        return { stream: toReadable(buffer), type: 'buffer' };
    }
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
        return { stream: yield getHttpStream(item.url, opts), type: 'remote' };
    }
    return { stream: createReadStream(item.url), type: 'file' };
});
/** generates a thumbnail for a given media, if required */
export function generateThumbnail(file, mediaType, options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        let thumbnail;
        let originalImageDimensions;
        if (mediaType === 'image') {
            const { buffer, original } = yield extractImageThumb(file);
            thumbnail = buffer.toString('base64');
            if (original.width && original.height) {
                originalImageDimensions = {
                    width: original.width,
                    height: original.height
                };
            }
        }
        else if (mediaType === 'video') {
            const imgFilename = join(getTmpFilesDirectory(), generateMessageIDV2() + '.jpg');
            try {
                yield extractVideoThumb(file, imgFilename, '00:00:00', { width: 32, height: 32 });
                const buff = yield fs.readFile(imgFilename);
                thumbnail = buff.toString('base64');
                yield fs.unlink(imgFilename);
            }
            catch (err) {
                (_a = options.logger) === null || _a === void 0 ? void 0 : _a.debug('could not generate video thumb: ' + err);
            }
        }
        return {
            thumbnail,
            originalImageDimensions
        };
    });
}
export const getHttpStream = (url_1, ...args_1) => __awaiter(void 0, [url_1, ...args_1], void 0, function* (url, options = {}) {
    const response = yield fetch(url.toString(), {
        dispatcher: options.dispatcher,
        method: 'GET',
        headers: options.headers
    });
    if (!response.ok) {
        throw new Boom(`Failed to fetch stream from ${url}`, { statusCode: response.status, data: { url } });
    }
    // @ts-ignore Node18+ Readable.fromWeb exists
    return response.body instanceof Readable ? response.body : Readable.fromWeb(response.body);
});
export const encryptedStream = (media_1, mediaType_1, ...args_1) => __awaiter(void 0, [media_1, mediaType_1, ...args_1], void 0, function* (media, mediaType, { logger, saveOriginalFileIfRequired, opts } = {}) {
    var _a, e_3, _b, _c;
    var _d, _e;
    const { stream, type } = yield getStream(media, opts);
    logger === null || logger === void 0 ? void 0 : logger.debug('fetched media stream');
    const mediaKey = Crypto.randomBytes(32);
    const { cipherKey, iv, macKey } = yield getMediaKeys(mediaKey, mediaType);
    const encFilePath = join(getTmpFilesDirectory(), mediaType + generateMessageIDV2() + '-enc');
    const encFileWriteStream = createWriteStream(encFilePath);
    let originalFileStream;
    let originalFilePath;
    if (saveOriginalFileIfRequired) {
        originalFilePath = join(getTmpFilesDirectory(), mediaType + generateMessageIDV2() + '-original');
        originalFileStream = createWriteStream(originalFilePath);
    }
    let fileLength = 0;
    const aes = Crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
    const hmac = Crypto.createHmac('sha256', macKey).update(iv);
    const sha256Plain = Crypto.createHash('sha256');
    const sha256Enc = Crypto.createHash('sha256');
    const onChunk = (buff) => __awaiter(void 0, void 0, void 0, function* () {
        sha256Enc.update(buff);
        hmac.update(buff);
        // Handle backpressure: if write returns false, wait for drain
        if (!encFileWriteStream.write(buff)) {
            yield once(encFileWriteStream, 'drain');
        }
    });
    try {
        try {
            for (var _f = true, stream_3 = __asyncValues(stream), stream_3_1; stream_3_1 = yield stream_3.next(), _a = stream_3_1.done, !_a; _f = true) {
                _c = stream_3_1.value;
                _f = false;
                const data = _c;
                fileLength += data.length;
                if (type === 'remote' &&
                    (opts === null || opts === void 0 ? void 0 : opts.maxContentLength) &&
                    fileLength + data.length > opts.maxContentLength) {
                    throw new Boom(`content length exceeded when encrypting "${type}"`, {
                        data: { media, type }
                    });
                }
                if (originalFileStream) {
                    if (!originalFileStream.write(data)) {
                        yield once(originalFileStream, 'drain');
                    }
                }
                sha256Plain.update(data);
                yield onChunk(aes.update(data));
            }
        }
        catch (e_3_1) { e_3 = { error: e_3_1 }; }
        finally {
            try {
                if (!_f && !_a && (_b = stream_3.return)) yield _b.call(stream_3);
            }
            finally { if (e_3) throw e_3.error; }
        }
        yield onChunk(aes.final());
        const mac = hmac.digest().slice(0, 10);
        sha256Enc.update(mac);
        const fileSha256 = sha256Plain.digest();
        const fileEncSha256 = sha256Enc.digest();
        encFileWriteStream.write(mac);
        const encFinishPromise = once(encFileWriteStream, 'finish');
        const originalFinishPromise = originalFileStream ? once(originalFileStream, 'finish') : Promise.resolve();
        encFileWriteStream.end();
        (_d = originalFileStream === null || originalFileStream === void 0 ? void 0 : originalFileStream.end) === null || _d === void 0 ? void 0 : _d.call(originalFileStream);
        stream.destroy();
        // Wait for write streams to fully flush to disk
        // This helps reduce memory pressure by allowing OS to release buffers
        yield encFinishPromise;
        yield originalFinishPromise;
        logger === null || logger === void 0 ? void 0 : logger.debug('encrypted data successfully');
        return {
            mediaKey,
            originalFilePath,
            encFilePath,
            mac,
            fileEncSha256,
            fileSha256,
            fileLength
        };
    }
    catch (error) {
        // destroy all streams with error
        encFileWriteStream.destroy();
        (_e = originalFileStream === null || originalFileStream === void 0 ? void 0 : originalFileStream.destroy) === null || _e === void 0 ? void 0 : _e.call(originalFileStream);
        aes.destroy();
        hmac.destroy();
        sha256Plain.destroy();
        sha256Enc.destroy();
        stream.destroy();
        try {
            yield fs.unlink(encFilePath);
            if (originalFilePath) {
                yield fs.unlink(originalFilePath);
            }
        }
        catch (err) {
            logger === null || logger === void 0 ? void 0 : logger.error({ err }, 'failed deleting tmp files');
        }
        throw error;
    }
});
const DEF_HOST = 'mmg.whatsapp.net';
const AES_CHUNK_SIZE = 16;
const toSmallestChunkSize = (num) => {
    return Math.floor(num / AES_CHUNK_SIZE) * AES_CHUNK_SIZE;
};
export const getUrlFromDirectPath = (directPath) => `https://${DEF_HOST}${directPath}`;
export const downloadContentFromMessage = (_a, type_1, ...args_1) => __awaiter(void 0, [_a, type_1, ...args_1], void 0, function* ({ mediaKey, directPath, url }, type, opts = {}) {
    const isValidMediaUrl = url === null || url === void 0 ? void 0 : url.startsWith('https://mmg.whatsapp.net/');
    const downloadUrl = isValidMediaUrl ? url : getUrlFromDirectPath(directPath);
    if (!downloadUrl) {
        throw new Boom('No valid media URL or directPath present in message', { statusCode: 400 });
    }
    const keys = yield getMediaKeys(mediaKey, type);
    return downloadEncryptedContent(downloadUrl, keys, opts);
});
/**
 * Decrypts and downloads an AES256-CBC encrypted file given the keys.
 * Assumes the SHA256 of the plaintext is appended to the end of the ciphertext
 * */
export const downloadEncryptedContent = (downloadUrl_1, _a, ...args_1) => __awaiter(void 0, [downloadUrl_1, _a, ...args_1], void 0, function* (downloadUrl, { cipherKey, iv }, { startByte, endByte, options } = {}) {
    let bytesFetched = 0;
    let startChunk = 0;
    let firstBlockIsIV = false;
    // if a start byte is specified -- then we need to fetch the previous chunk as that will form the IV
    if (startByte) {
        const chunk = toSmallestChunkSize(startByte || 0);
        if (chunk) {
            startChunk = chunk - AES_CHUNK_SIZE;
            bytesFetched = chunk;
            firstBlockIsIV = true;
        }
    }
    const endChunk = endByte ? toSmallestChunkSize(endByte || 0) + AES_CHUNK_SIZE : undefined;
    const headersInit = (options === null || options === void 0 ? void 0 : options.headers) ? options.headers : undefined;
    const headers = Object.assign(Object.assign({}, (headersInit
        ? Array.isArray(headersInit)
            ? Object.fromEntries(headersInit)
            : headersInit
        : {})), { Origin: DEFAULT_ORIGIN });
    if (startChunk || endChunk) {
        headers.Range = `bytes=${startChunk}-`;
        if (endChunk) {
            headers.Range += endChunk;
        }
    }
    // download the message
    const fetched = yield getHttpStream(downloadUrl, Object.assign(Object.assign({}, (options || {})), { headers }));
    let remainingBytes = Buffer.from([]);
    let aes;
    const pushBytes = (bytes, push) => {
        if (startByte || endByte) {
            const start = bytesFetched >= startByte ? undefined : Math.max(startByte - bytesFetched, 0);
            const end = bytesFetched + bytes.length < endByte ? undefined : Math.max(endByte - bytesFetched, 0);
            push(bytes.slice(start, end));
            bytesFetched += bytes.length;
        }
        else {
            push(bytes);
        }
    };
    const output = new Transform({
        transform(chunk, _, callback) {
            let data = remainingBytes.length ? Buffer.concat([remainingBytes, chunk]) : chunk;
            const decryptLength = toSmallestChunkSize(data.length);
            remainingBytes = data.slice(decryptLength);
            data = data.slice(0, decryptLength);
            if (!aes) {
                let ivValue = iv;
                if (firstBlockIsIV) {
                    ivValue = data.slice(0, AES_CHUNK_SIZE);
                    data = data.slice(AES_CHUNK_SIZE);
                }
                aes = Crypto.createDecipheriv('aes-256-cbc', cipherKey, ivValue);
                // if an end byte that is not EOF is specified
                // stop auto padding (PKCS7) -- otherwise throws an error for decryption
                if (endByte) {
                    aes.setAutoPadding(false);
                }
            }
            try {
                pushBytes(aes.update(data), b => this.push(b));
                callback();
            }
            catch (error) {
                callback(error);
            }
        },
        final(callback) {
            try {
                pushBytes(aes.final(), b => this.push(b));
                callback();
            }
            catch (error) {
                callback(error);
            }
        }
    });
    return fetched.pipe(output, { end: true });
});
export function extensionForMediaMessage(message) {
    const getExtension = (mimetype) => { var _a; return (_a = mimetype.split(';')[0]) === null || _a === void 0 ? void 0 : _a.split('/')[1]; };
    const type = Object.keys(message)[0];
    let extension;
    if (type === 'locationMessage' || type === 'liveLocationMessage' || type === 'productMessage') {
        extension = '.jpeg';
    }
    else {
        const messageContent = message[type];
        extension = getExtension(messageContent.mimetype);
    }
    return extension;
}
const isNodeRuntime = () => {
    var _a;
    return (typeof process !== 'undefined' &&
        ((_a = process.versions) === null || _a === void 0 ? void 0 : _a.node) !== null &&
        typeof process.versions.bun === 'undefined' &&
        typeof globalThis.Deno === 'undefined');
};
export const uploadWithNodeHttp = (_a, ...args_1) => __awaiter(void 0, [_a, ...args_1], void 0, function* ({ url, filePath, headers, timeoutMs, agent }, redirectCount = 0) {
    if (redirectCount > 5) {
        throw new Error('Too many redirects');
    }
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? yield import('https') : yield import('http');
    // Get file size for Content-Length header (required for Node.js streaming)
    const fileStats = yield fs.stat(filePath);
    const fileSize = fileStats.size;
    return new Promise((resolve, reject) => {
        const req = httpModule.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: Object.assign(Object.assign({}, headers), { 'Content-Length': fileSize }),
            agent,
            timeout: timeoutMs
        }, res => {
            // Handle redirects (3xx)
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume(); // Consume response to free resources
                const newUrl = new URL(res.headers.location, url).toString();
                resolve(uploadWithNodeHttp({
                    url: newUrl,
                    filePath,
                    headers,
                    timeoutMs,
                    agent
                }, redirectCount + 1));
                return;
            }
            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch (_a) {
                    resolve(undefined);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Upload timeout'));
        });
        const stream = createReadStream(filePath);
        stream.pipe(req);
        stream.on('error', err => {
            req.destroy();
            reject(err);
        });
    });
});
const uploadWithFetch = (_a) => __awaiter(void 0, [_a], void 0, function* ({ url, filePath, headers, timeoutMs, agent }) {
    // Convert Node.js Readable to Web ReadableStream
    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream);
    const response = yield fetch(url, {
        dispatcher: agent,
        method: 'POST',
        body: webStream,
        headers,
        duplex: 'half',
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    });
    try {
        return (yield response.json());
    }
    catch (_b) {
        return undefined;
    }
});
/**
 * Uploads media to WhatsApp servers.
 *
 * ## Why we have two upload implementations:
 *
 * Node.js's native `fetch` (powered by undici) has a known bug where it buffers
 * the entire request body in memory before sending, even when using streams.
 * This causes memory issues with large files (e.g., 1GB file = 1GB+ memory usage).
 * See: https://github.com/nodejs/undici/issues/4058
 *
 * Other runtimes (Bun, Deno, browsers) correctly stream the request body without
 * buffering, so we can use the web-standard Fetch API there.
 *
 * ## Future considerations:
 * Once the undici bug is fixed, we can simplify this to use only the Fetch API
 * across all runtimes. Monitor the GitHub issue for updates.
 */
const uploadMedia = (params, logger) => __awaiter(void 0, void 0, void 0, function* () {
    if (isNodeRuntime()) {
        logger === null || logger === void 0 ? void 0 : logger.debug('Using Node.js https module for upload (avoids undici buffering bug)');
        return uploadWithNodeHttp(params);
    }
    else {
        logger === null || logger === void 0 ? void 0 : logger.debug('Using web-standard Fetch API for upload');
        return uploadWithFetch(params);
    }
});
export const getWAUploadToServer = ({ customUploadHosts, fetchAgent, logger, options }, refreshMediaConn) => {
    return (filePath_1, _a) => __awaiter(void 0, [filePath_1, _a], void 0, function* (filePath, { mediaType, fileEncSha256B64, timeoutMs }) {
        var _b;
        // send a query JSON to obtain the url & auth token to upload our media
        let uploadInfo = yield refreshMediaConn(false);
        let urls;
        const hosts = [...customUploadHosts, ...uploadInfo.hosts];
        fileEncSha256B64 = encodeBase64EncodedStringForUpload(fileEncSha256B64);
        // Prepare common headers
        const customHeaders = (() => {
            const hdrs = options === null || options === void 0 ? void 0 : options.headers;
            if (!hdrs)
                return {};
            return Array.isArray(hdrs) ? Object.fromEntries(hdrs) : hdrs;
        })();
        const headers = Object.assign(Object.assign({}, customHeaders), { 'Content-Type': 'application/octet-stream', Origin: DEFAULT_ORIGIN });
        for (const { hostname } of hosts) {
            logger.debug(`uploading to "${hostname}"`);
            const auth = encodeURIComponent(uploadInfo.auth);
            const url = `https://${hostname}${MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`;
            let result;
            try {
                result = yield uploadMedia({
                    url,
                    filePath,
                    headers,
                    timeoutMs,
                    agent: fetchAgent
                }, logger);
                if ((result === null || result === void 0 ? void 0 : result.url) || (result === null || result === void 0 ? void 0 : result.direct_path)) {
                    urls = {
                        mediaUrl: result.url,
                        directPath: result.direct_path,
                        meta_hmac: result.meta_hmac,
                        fbid: result.fbid,
                        ts: result.ts
                    };
                    break;
                }
                else {
                    uploadInfo = yield refreshMediaConn(true);
                    throw new Error(`upload failed, reason: ${JSON.stringify(result)}`);
                }
            }
            catch (error) {
                const isLast = hostname === ((_b = hosts[uploadInfo.hosts.length - 1]) === null || _b === void 0 ? void 0 : _b.hostname);
                logger.warn({ trace: error === null || error === void 0 ? void 0 : error.stack, uploadResult: result }, `Error in uploading to ${hostname} ${isLast ? '' : ', retrying...'}`);
            }
        }
        if (!urls) {
            throw new Boom('Media upload failed on all hosts', { statusCode: 500 });
        }
        return urls;
    });
};
const getMediaRetryKey = (mediaKey) => {
    return hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' });
};
/**
 * Generate a binary node that will request the phone to re-upload the media & return the newly uploaded URL
 */
export const encryptMediaRetryRequest = (key, mediaKey, meId) => {
    const recp = { stanzaId: key.id };
    const recpBuffer = proto.ServerErrorReceipt.encode(recp).finish();
    const iv = Crypto.randomBytes(12);
    const retryKey = getMediaRetryKey(mediaKey);
    const ciphertext = aesEncryptGCM(recpBuffer, retryKey, iv, Buffer.from(key.id));
    const req = {
        tag: 'receipt',
        attrs: {
            id: key.id,
            to: jidNormalizedUser(meId),
            type: 'server-error'
        },
        content: [
            // this encrypt node is actually pretty useless
            // the media is returned even without this node
            // keeping it here to maintain parity with WA Web
            {
                tag: 'encrypt',
                attrs: {},
                content: [
                    { tag: 'enc_p', attrs: {}, content: ciphertext },
                    { tag: 'enc_iv', attrs: {}, content: iv }
                ]
            },
            {
                tag: 'rmr',
                attrs: {
                    jid: key.remoteJid,
                    from_me: (!!key.fromMe).toString(),
                    // @ts-ignore
                    participant: key.participant || undefined
                }
            }
        ]
    };
    return req;
};
export const decodeMediaRetryNode = (node) => {
    const rmrNode = getBinaryNodeChild(node, 'rmr');
    const event = {
        key: {
            id: node.attrs.id,
            remoteJid: rmrNode.attrs.jid,
            fromMe: rmrNode.attrs.from_me === 'true',
            participant: rmrNode.attrs.participant
        }
    };
    const errorNode = getBinaryNodeChild(node, 'error');
    if (errorNode) {
        const errorCode = +errorNode.attrs.code;
        event.error = new Boom(`Failed to re-upload media (${errorCode})`, {
            data: errorNode.attrs,
            statusCode: getStatusCodeForMediaRetry(errorCode)
        });
    }
    else {
        const encryptedInfoNode = getBinaryNodeChild(node, 'encrypt');
        const ciphertext = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_p');
        const iv = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_iv');
        if (ciphertext && iv) {
            event.media = { ciphertext, iv };
        }
        else {
            event.error = new Boom('Failed to re-upload media (missing ciphertext)', { statusCode: 404 });
        }
    }
    return event;
};
export const decryptMediaRetryData = ({ ciphertext, iv }, mediaKey, msgId) => {
    const retryKey = getMediaRetryKey(mediaKey);
    const plaintext = aesDecryptGCM(ciphertext, retryKey, iv, Buffer.from(msgId));
    return proto.MediaRetryNotification.decode(plaintext);
};
export const getStatusCodeForMediaRetry = (code) => MEDIA_RETRY_STATUS_MAP[code];
const MEDIA_RETRY_STATUS_MAP = {
    [proto.MediaRetryNotification.ResultType.SUCCESS]: 200,
    [proto.MediaRetryNotification.ResultType.DECRYPTION_ERROR]: 412,
    [proto.MediaRetryNotification.ResultType.NOT_FOUND]: 404,
    [proto.MediaRetryNotification.ResultType.GENERAL_ERROR]: 418
};
