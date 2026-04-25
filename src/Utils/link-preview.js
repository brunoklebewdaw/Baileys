var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prepareWAMessageMedia } from './messages';
import { extractImageThumb, getHttpStream } from './messages-media';
const THUMBNAIL_WIDTH_PX = 192;
/** Fetches an image and generates a thumbnail for it */
const getCompressedJpegThumbnail = (url_1, _a) => __awaiter(void 0, [url_1, _a], void 0, function* (url, { thumbnailWidth, fetchOpts }) {
    const stream = yield getHttpStream(url, fetchOpts);
    const result = yield extractImageThumb(stream, thumbnailWidth);
    return result;
});
/**
 * Given a piece of text, checks for any URL present, generates link preview for the same and returns it
 * Return undefined if the fetch failed or no URL was found
 * @param text first matched URL in text
 * @returns the URL info required to generate link preview
 */
export const getUrlInfo = (text_1, ...args_1) => __awaiter(void 0, [text_1, ...args_1], void 0, function* (text, opts = {
    thumbnailWidth: THUMBNAIL_WIDTH_PX,
    fetchOpts: { timeout: 3000 }
}) {
    var _a, _b;
    try {
        // retries
        const retries = 0;
        const maxRetry = 5;
        const { getLinkPreview } = yield import('link-preview-js');
        let previewLink = text;
        if (!text.startsWith('https://') && !text.startsWith('http://')) {
            previewLink = 'https://' + previewLink;
        }
        const info = yield getLinkPreview(previewLink, Object.assign(Object.assign({}, opts.fetchOpts), { followRedirects: 'follow', handleRedirects: (baseURL, forwardedURL) => {
                const urlObj = new URL(baseURL);
                const forwardedURLObj = new URL(forwardedURL);
                if (retries >= maxRetry) {
                    return false;
                }
                if (forwardedURLObj.hostname === urlObj.hostname ||
                    forwardedURLObj.hostname === 'www.' + urlObj.hostname ||
                    'www.' + forwardedURLObj.hostname === urlObj.hostname) {
                    retries + 1;
                    return true;
                }
                else {
                    return false;
                }
            }, headers: (_a = opts.fetchOpts) === null || _a === void 0 ? void 0 : _a.headers }));
        if (info && 'title' in info && info.title) {
            const [image] = info.images;
            const urlInfo = {
                'canonical-url': info.url,
                'matched-text': text,
                title: info.title,
                description: info.description,
                originalThumbnailUrl: image
            };
            if (opts.uploadImage) {
                const { imageMessage } = yield prepareWAMessageMedia({ image: { url: image } }, {
                    upload: opts.uploadImage,
                    mediaTypeOverride: 'thumbnail-link',
                    options: opts.fetchOpts
                });
                urlInfo.jpegThumbnail = (imageMessage === null || imageMessage === void 0 ? void 0 : imageMessage.jpegThumbnail) ? Buffer.from(imageMessage.jpegThumbnail) : undefined;
                urlInfo.highQualityThumbnail = imageMessage || undefined;
            }
            else {
                try {
                    urlInfo.jpegThumbnail = image ? (yield getCompressedJpegThumbnail(image, opts)).buffer : undefined;
                }
                catch (error) {
                    (_b = opts.logger) === null || _b === void 0 ? void 0 : _b.debug({ err: error.stack, url: previewLink }, 'error in generating thumbnail');
                }
            }
            return urlInfo;
        }
    }
    catch (error) {
        if (!error.message.includes('receive a valid')) {
            throw error;
        }
    }
});
