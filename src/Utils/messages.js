var __awaiter =
	(this && this.__awaiter) ||
	function (thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P
				? value
				: new P(function (resolve) {
						resolve(value)
					})
		}
		return new (P || (P = Promise))(function (resolve, reject) {
			function fulfilled(value) {
				try {
					step(generator.next(value))
				} catch (e) {
					reject(e)
				}
			}
			function rejected(value) {
				try {
					step(generator['throw'](value))
				} catch (e) {
					reject(e)
				}
			}
			function step(result) {
				result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected)
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next())
		})
	}
var __asyncValues =
	(this && this.__asyncValues) ||
	function (o) {
		if (!Symbol.asyncIterator) throw new TypeError('Symbol.asyncIterator is not defined.')
		var m = o[Symbol.asyncIterator],
			i
		return m
			? m.call(o)
			: ((o = typeof __values === 'function' ? __values(o) : o[Symbol.iterator]()),
				(i = {}),
				verb('next'),
				verb('throw'),
				verb('return'),
				(i[Symbol.asyncIterator] = function () {
					return this
				}),
				i)
		function verb(n) {
			i[n] =
				o[n] &&
				function (v) {
					return new Promise(function (resolve, reject) {
						;((v = o[n](v)), settle(resolve, reject, v.done, v.value))
					})
				}
		}
		function settle(resolve, reject, d, v) {
			Promise.resolve(v).then(function (v) {
				resolve({ value: v, done: d })
			}, reject)
		}
	}
import { Boom } from '@hapi/boom'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { proto } from '../../WAProto/index.js'
import { CALL_AUDIO_PREFIX, CALL_VIDEO_PREFIX, MEDIA_KEYS, URL_REGEX, WA_DEFAULT_EPHEMERAL } from '../Defaults'
import { WAMessageStatus, WAProto } from '../Types'
import { isJidGroup, isJidNewsletter, isJidStatusBroadcast, jidNormalizedUser } from '../WABinary'
import { sha256 } from './crypto'
import { generateMessageIDV2, getKeyAuthor, unixTimestampSeconds } from './generics'
import {
	downloadContentFromMessage,
	encryptedStream,
	generateThumbnail,
	getAudioDuration,
	getAudioWaveform,
	getRawMediaUploadData
} from './messages-media'
import { shouldIncludeReportingToken } from './reporting-utils'
const MIMETYPE_MAP = {
	image: 'image/jpeg',
	video: 'video/mp4',
	document: 'application/pdf',
	audio: 'audio/ogg; codecs=opus',
	sticker: 'image/webp',
	'product-catalog-image': 'image/jpeg'
}
const MessageTypeProto = {
	image: WAProto.Message.ImageMessage,
	video: WAProto.Message.VideoMessage,
	audio: WAProto.Message.AudioMessage,
	sticker: WAProto.Message.StickerMessage,
	document: WAProto.Message.DocumentMessage
}
/**
 * Uses a regex to test whether the string contains a URL, and returns the URL if it does.
 * @param text eg. hello https://google.com
 * @returns the URL, eg. https://google.com
 */
export const extractUrlFromText = text => {
	var _a
	return (_a = text.match(URL_REGEX)) === null || _a === void 0 ? void 0 : _a[0]
}
export const generateLinkPreviewIfRequired = (text, getUrlInfo, logger) =>
	__awaiter(void 0, void 0, void 0, function* () {
		const url = extractUrlFromText(text)
		if (!!getUrlInfo && url) {
			try {
				const urlInfo = yield getUrlInfo(url)
				return urlInfo
			} catch (error) {
				// ignore if fails
				logger === null || logger === void 0 ? void 0 : logger.warn({ trace: error.stack }, 'url generation failed')
			}
		}
	})
const assertColor = color =>
	__awaiter(void 0, void 0, void 0, function* () {
		let assertedColor
		if (typeof color === 'number') {
			assertedColor = color > 0 ? color : 0xffffffff + Number(color) + 1
		} else {
			let hex = color.trim().replace('#', '')
			if (hex.length <= 6) {
				hex = 'FF' + hex.padStart(6, '0')
			}
			assertedColor = parseInt(hex, 16)
			return assertedColor
		}
	})
export const prepareWAMessageMedia = (message, options) =>
	__awaiter(void 0, void 0, void 0, function* () {
		const logger = options.logger
		let mediaType
		for (const key of MEDIA_KEYS) {
			if (key in message) {
				mediaType = key
			}
		}
		if (!mediaType) {
			throw new Boom('Invalid media type', { statusCode: 400 })
		}
		const uploadData = Object.assign(Object.assign({}, message), { media: message[mediaType] })
		delete uploadData[mediaType]
		// check if cacheable + generate cache key
		const cacheableKey =
			typeof uploadData.media === 'object' &&
			'url' in uploadData.media &&
			!!uploadData.media.url &&
			!!options.mediaCache &&
			mediaType + ':' + uploadData.media.url.toString()
		if (mediaType === 'document' && !uploadData.fileName) {
			uploadData.fileName = 'file'
		}
		if (!uploadData.mimetype) {
			uploadData.mimetype = MIMETYPE_MAP[mediaType]
		}
		if (cacheableKey) {
			const mediaBuff = yield options.mediaCache.get(cacheableKey)
			if (mediaBuff) {
				logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'got media cache hit')
				const obj = proto.Message.decode(mediaBuff)
				const key = `${mediaType}Message`
				Object.assign(obj[key], Object.assign(Object.assign({}, uploadData), { media: undefined }))
				return obj
			}
		}
		const isNewsletter = !!options.jid && isJidNewsletter(options.jid)
		if (isNewsletter) {
			logger === null || logger === void 0
				? void 0
				: logger.info({ key: cacheableKey }, 'Preparing raw media for newsletter')
			const { filePath, fileSha256, fileLength } = yield getRawMediaUploadData(
				uploadData.media,
				options.mediaTypeOverride || mediaType,
				logger
			)
			const fileSha256B64 = fileSha256.toString('base64')
			const { mediaUrl, directPath } = yield options.upload(filePath, {
				fileEncSha256B64: fileSha256B64,
				mediaType: mediaType,
				timeoutMs: options.mediaUploadTimeoutMs
			})
			yield fs.unlink(filePath)
			const obj = WAProto.Message.fromObject({
				// todo: add more support here
				[`${mediaType}Message`]: MessageTypeProto[mediaType].fromObject(
					Object.assign(Object.assign({ url: mediaUrl, directPath, fileSha256, fileLength }, uploadData), {
						media: undefined
					})
				)
			})
			if (uploadData.ptv) {
				obj.ptvMessage = obj.videoMessage
				delete obj.videoMessage
			}
			if (obj.stickerMessage) {
				obj.stickerMessage.stickerSentTs = Date.now()
			}
			if (cacheableKey) {
				logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'set cache')
				yield options.mediaCache.set(cacheableKey, WAProto.Message.encode(obj).finish())
			}
			return obj
		}
		const requiresDurationComputation = mediaType === 'audio' && typeof uploadData.seconds === 'undefined'
		const requiresThumbnailComputation =
			(mediaType === 'image' || mediaType === 'video') && typeof uploadData['jpegThumbnail'] === 'undefined'
		const requiresWaveformProcessing =
			mediaType === 'audio' && uploadData.ptt === true && typeof uploadData.waveform === 'undefined'
		const requiresAudioBackground = options.backgroundColor && mediaType === 'audio' && uploadData.ptt === true
		const requiresOriginalForSomeProcessing = requiresDurationComputation || requiresThumbnailComputation
		const { mediaKey, encFilePath, originalFilePath, fileEncSha256, fileSha256, fileLength } = yield encryptedStream(
			uploadData.media,
			options.mediaTypeOverride || mediaType,
			{
				logger,
				saveOriginalFileIfRequired: requiresOriginalForSomeProcessing,
				opts: options.options
			}
		)
		const fileEncSha256B64 = fileEncSha256.toString('base64')
		const [{ mediaUrl, directPath }] = yield Promise.all([
			(() =>
				__awaiter(void 0, void 0, void 0, function* () {
					const result = yield options.upload(encFilePath, {
						fileEncSha256B64,
						mediaType,
						timeoutMs: options.mediaUploadTimeoutMs
					})
					logger === null || logger === void 0 ? void 0 : logger.debug({ mediaType, cacheableKey }, 'uploaded media')
					return result
				}))(),
			(() =>
				__awaiter(void 0, void 0, void 0, function* () {
					try {
						if (requiresThumbnailComputation) {
							const { thumbnail, originalImageDimensions } = yield generateThumbnail(
								originalFilePath,
								mediaType,
								options
							)
							uploadData.jpegThumbnail = thumbnail
							if (!uploadData.width && originalImageDimensions) {
								uploadData.width = originalImageDimensions.width
								uploadData.height = originalImageDimensions.height
								logger === null || logger === void 0 ? void 0 : logger.debug('set dimensions')
							}
							logger === null || logger === void 0 ? void 0 : logger.debug('generated thumbnail')
						}
						if (requiresDurationComputation) {
							uploadData.seconds = yield getAudioDuration(originalFilePath)
							logger === null || logger === void 0 ? void 0 : logger.debug('computed audio duration')
						}
						if (requiresWaveformProcessing) {
							uploadData.waveform = yield getAudioWaveform(originalFilePath, logger)
							logger === null || logger === void 0 ? void 0 : logger.debug('processed waveform')
						}
						if (requiresAudioBackground) {
							uploadData.backgroundArgb = yield assertColor(options.backgroundColor)
							logger === null || logger === void 0 ? void 0 : logger.debug('computed backgroundColor audio status')
						}
					} catch (error) {
						logger === null || logger === void 0
							? void 0
							: logger.warn({ trace: error.stack }, 'failed to obtain extra info')
					}
				}))()
		]).finally(() =>
			__awaiter(void 0, void 0, void 0, function* () {
				try {
					yield fs.unlink(encFilePath)
					if (originalFilePath) {
						yield fs.unlink(originalFilePath)
					}
					logger === null || logger === void 0 ? void 0 : logger.debug('removed tmp files')
				} catch (error) {
					logger === null || logger === void 0 ? void 0 : logger.warn('failed to remove tmp file')
				}
			})
		)
		const obj = WAProto.Message.fromObject({
			[`${mediaType}Message`]: MessageTypeProto[mediaType].fromObject(
				Object.assign(
					Object.assign(
						{
							url: mediaUrl,
							directPath,
							mediaKey,
							fileEncSha256,
							fileSha256,
							fileLength,
							mediaKeyTimestamp: unixTimestampSeconds()
						},
						uploadData
					),
					{ media: undefined }
				)
			)
		})
		if (uploadData.ptv) {
			obj.ptvMessage = obj.videoMessage
			delete obj.videoMessage
		}
		if (cacheableKey) {
			logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'set cache')
			yield options.mediaCache.set(cacheableKey, WAProto.Message.encode(obj).finish())
		}
		return obj
	})
export const prepareDisappearingMessageSettingContent = ephemeralExpiration => {
	ephemeralExpiration = ephemeralExpiration || 0
	const content = {
		ephemeralMessage: {
			message: {
				protocolMessage: {
					type: WAProto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
					ephemeralExpiration
				}
			}
		}
	}
	return WAProto.Message.fromObject(content)
}
/**
 * Generate forwarded message content like WA does
 * @param message the message to forward
 * @param options.forceForward will show the message as forwarded even if it is from you
 */
export const generateForwardMessageContent = (message, forceForward) => {
	var _a, _b
	let content = message.message
	if (!content) {
		throw new Boom('no content in message', { statusCode: 400 })
	}
	// hacky copy
	content = normalizeMessageContent(content)
	content = proto.Message.decode(proto.Message.encode(content).finish())
	let key = Object.keys(content)[0]
	let score =
		((_b =
			(_a = content === null || content === void 0 ? void 0 : content[key]) === null || _a === void 0
				? void 0
				: _a.contextInfo) === null || _b === void 0
			? void 0
			: _b.forwardingScore) || 0
	score += message.key.fromMe && !forceForward ? 0 : 1
	if (key === 'conversation') {
		content.extendedTextMessage = { text: content[key] }
		delete content.conversation
		key = 'extendedTextMessage'
	}
	const key_ = content === null || content === void 0 ? void 0 : content[key]
	if (score > 0) {
		key_.contextInfo = { forwardingScore: score, isForwarded: true }
	} else {
		key_.contextInfo = {}
	}
	return content
}
export const hasNonNullishProperty = (message, key) => {
	return (
		typeof message === 'object' &&
		message !== null &&
		key in message &&
		message[key] !== null &&
		message[key] !== undefined
	)
}
function hasOptionalProperty(obj, key) {
	return typeof obj === 'object' && obj !== null && key in obj && obj[key] !== null
}
export const generateWAMessageContent = (message, options) =>
	__awaiter(void 0, void 0, void 0, function* () {
		var _a, _b, _c, _d, _e
		var _f, _g
		let m = {}
		if (hasNonNullishProperty(message, 'text')) {
			const extContent = { text: message.text }
			let urlInfo = message.linkPreview
			if (typeof urlInfo === 'undefined') {
				urlInfo = yield generateLinkPreviewIfRequired(message.text, options.getUrlInfo, options.logger)
			}
			if (urlInfo) {
				extContent.matchedText = urlInfo['matched-text']
				extContent.jpegThumbnail = urlInfo.jpegThumbnail
				extContent.description = urlInfo.description
				extContent.title = urlInfo.title
				extContent.previewType = 0
				const img = urlInfo.highQualityThumbnail
				if (img) {
					extContent.thumbnailDirectPath = img.directPath
					extContent.mediaKey = img.mediaKey
					extContent.mediaKeyTimestamp = img.mediaKeyTimestamp
					extContent.thumbnailWidth = img.width
					extContent.thumbnailHeight = img.height
					extContent.thumbnailSha256 = img.fileSha256
					extContent.thumbnailEncSha256 = img.fileEncSha256
				}
			}
			if (options.backgroundColor) {
				extContent.backgroundArgb = yield assertColor(options.backgroundColor)
			}
			if (options.font) {
				extContent.font = options.font
			}
			m.extendedTextMessage = extContent
		} else if (hasNonNullishProperty(message, 'contacts')) {
			const contactLen = message.contacts.contacts.length
			if (!contactLen) {
				throw new Boom('require atleast 1 contact', { statusCode: 400 })
			}
			if (contactLen === 1) {
				m.contactMessage = WAProto.Message.ContactMessage.create(message.contacts.contacts[0])
			} else {
				m.contactsArrayMessage = WAProto.Message.ContactsArrayMessage.create(message.contacts)
			}
		} else if (hasNonNullishProperty(message, 'location')) {
			m.locationMessage = WAProto.Message.LocationMessage.create(message.location)
		} else if (hasNonNullishProperty(message, 'react')) {
			if (!message.react.senderTimestampMs) {
				message.react.senderTimestampMs = Date.now()
			}
			m.reactionMessage = WAProto.Message.ReactionMessage.create(message.react)
		} else if (hasNonNullishProperty(message, 'delete')) {
			m.protocolMessage = {
				key: message.delete,
				type: WAProto.Message.ProtocolMessage.Type.REVOKE
			}
		} else if (hasNonNullishProperty(message, 'forward')) {
			m = generateForwardMessageContent(message.forward, message.force)
		} else if (hasNonNullishProperty(message, 'disappearingMessagesInChat')) {
			const exp =
				typeof message.disappearingMessagesInChat === 'boolean'
					? message.disappearingMessagesInChat
						? WA_DEFAULT_EPHEMERAL
						: 0
					: message.disappearingMessagesInChat
			m = prepareDisappearingMessageSettingContent(exp)
		} else if (hasNonNullishProperty(message, 'groupInvite')) {
			m.groupInviteMessage = {}
			m.groupInviteMessage.inviteCode = message.groupInvite.inviteCode
			m.groupInviteMessage.inviteExpiration = message.groupInvite.inviteExpiration
			m.groupInviteMessage.caption = message.groupInvite.text
			m.groupInviteMessage.groupJid = message.groupInvite.jid
			m.groupInviteMessage.groupName = message.groupInvite.subject
			//TODO: use built-in interface and get disappearing mode info etc.
			//TODO: cache / use store!?
			if (options.getProfilePicUrl) {
				const pfpUrl = yield options.getProfilePicUrl(message.groupInvite.jid, 'preview')
				if (pfpUrl) {
					const resp = yield fetch(pfpUrl, {
						method: 'GET',
						dispatcher:
							(_a = options === null || options === void 0 ? void 0 : options.options) === null || _a === void 0
								? void 0
								: _a.dispatcher
					})
					if (resp.ok) {
						const buf = Buffer.from(yield resp.arrayBuffer())
						m.groupInviteMessage.jpegThumbnail = buf
					}
				}
			}
		} else if (hasNonNullishProperty(message, 'pin')) {
			m.pinInChatMessage = {}
			m.messageContextInfo = {}
			m.pinInChatMessage.key = message.pin
			m.pinInChatMessage.type = message.type
			m.pinInChatMessage.senderTimestampMs = Date.now()
			m.messageContextInfo.messageAddOnDurationInSecs = message.type === 1 ? message.time || 86400 : 0
		} else if (hasNonNullishProperty(message, 'buttonReply')) {
			switch (message.type) {
				case 'template':
					m.templateButtonReplyMessage = {
						selectedDisplayText: message.buttonReply.displayText,
						selectedId: message.buttonReply.id,
						selectedIndex: message.buttonReply.index
					}
					break
				case 'plain':
					m.buttonsResponseMessage = {
						selectedButtonId: message.buttonReply.id,
						selectedDisplayText: message.buttonReply.displayText,
						type: proto.Message.ButtonsResponseMessage.Type.DISPLAY_TEXT
					}
					break
			}
		} else if (hasOptionalProperty(message, 'ptv') && message.ptv) {
			const { videoMessage } = yield prepareWAMessageMedia({ video: message.video }, options)
			m.ptvMessage = videoMessage
		} else if (hasNonNullishProperty(message, 'product')) {
			const { imageMessage } = yield prepareWAMessageMedia({ image: message.product.productImage }, options)
			m.productMessage = WAProto.Message.ProductMessage.create(
				Object.assign(Object.assign({}, message), {
					product: Object.assign(Object.assign({}, message.product), { productImage: imageMessage })
				})
			)
		} else if (hasNonNullishProperty(message, 'listReply')) {
			m.listResponseMessage = Object.assign({}, message.listReply)
		} else if (hasNonNullishProperty(message, 'event')) {
			m.eventMessage = {}
			const startTime = Math.floor(message.event.startDate.getTime() / 1000)
			if (message.event.call && options.getCallLink) {
				const token = yield options.getCallLink(message.event.call, { startTime })
				m.eventMessage.joinLink = (message.event.call === 'audio' ? CALL_AUDIO_PREFIX : CALL_VIDEO_PREFIX) + token
			}
			m.messageContextInfo = {
				// encKey
				messageSecret: message.event.messageSecret || randomBytes(32)
			}
			m.eventMessage.name = message.event.name
			m.eventMessage.description = message.event.description
			m.eventMessage.startTime = startTime
			m.eventMessage.endTime = message.event.endDate ? message.event.endDate.getTime() / 1000 : undefined
			m.eventMessage.isCanceled = (_b = message.event.isCancelled) !== null && _b !== void 0 ? _b : false
			m.eventMessage.extraGuestsAllowed = message.event.extraGuestsAllowed
			m.eventMessage.isScheduleCall = (_c = message.event.isScheduleCall) !== null && _c !== void 0 ? _c : false
			m.eventMessage.location = message.event.location
		} else if (hasNonNullishProperty(message, 'poll')) {
			;(_f = message.poll).selectableCount || (_f.selectableCount = 0)
			;(_g = message.poll).toAnnouncementGroup || (_g.toAnnouncementGroup = false)
			if (!Array.isArray(message.poll.values)) {
				throw new Boom('Invalid poll values', { statusCode: 400 })
			}
			if (message.poll.selectableCount < 0 || message.poll.selectableCount > message.poll.values.length) {
				throw new Boom(`poll.selectableCount in poll should be >= 0 and <= ${message.poll.values.length}`, {
					statusCode: 400
				})
			}
			m.messageContextInfo = {
				// encKey
				messageSecret: message.poll.messageSecret || randomBytes(32)
			}
			const pollCreationMessage = {
				name: message.poll.name,
				selectableOptionsCount: message.poll.selectableCount,
				options: message.poll.values.map(optionName => ({ optionName }))
			}
			if (message.poll.toAnnouncementGroup) {
				// poll v2 is for community announcement groups (single select and multiple)
				m.pollCreationMessageV2 = pollCreationMessage
			} else {
				if (message.poll.selectableCount === 1) {
					//poll v3 is for single select polls
					m.pollCreationMessageV3 = pollCreationMessage
				} else {
					// poll for multiple choice polls
					m.pollCreationMessage = pollCreationMessage
				}
			}
		} else if (hasNonNullishProperty(message, 'album')) {
			m.albumMessage = {
				expectedImageCount: message.album.expectedImageCount,
				expectedVideoCount: message.album.expectedVideoCount
			}
		} else if (hasNonNullishProperty(message, 'sharePhoneNumber')) {
			m.protocolMessage = {
				type: proto.Message.ProtocolMessage.Type.SHARE_PHONE_NUMBER
			}
		} else if (hasNonNullishProperty(message, 'requestPhoneNumber')) {
			m.requestPhoneNumberMessage = {}
		} else if (hasNonNullishProperty(message, 'limitSharing')) {
			m.protocolMessage = {
				type: proto.Message.ProtocolMessage.Type.LIMIT_SHARING,
				limitSharing: {
					sharingLimited: message.limitSharing === true,
					trigger: 1,
					limitSharingSettingTimestamp: Date.now(),
					initiatedByMe: true
				}
			}
		} else {
			m = yield prepareWAMessageMedia(message, options)
		}
		if (hasOptionalProperty(message, 'viewOnce') && !!message.viewOnce) {
			m = { viewOnceMessage: { message: m } }
		}
		if (
			(hasOptionalProperty(message, 'mentions') &&
				((_d = message.mentions) === null || _d === void 0 ? void 0 : _d.length)) ||
			(hasOptionalProperty(message, 'mentionAll') && message.mentionAll)
		) {
			const messageType = Object.keys(m)[0]
			const key = m[messageType]
			if (key && 'contextInfo' in key) {
				key.contextInfo = key.contextInfo || {}
				if ((_e = message.mentions) === null || _e === void 0 ? void 0 : _e.length) {
					key.contextInfo.mentionedJid = message.mentions
				}
				if (message.mentionAll) {
					key.contextInfo.nonJidMentions = 1
				}
			} else if (key) {
				key.contextInfo = {
					mentionedJid: message.mentions,
					nonJidMentions: message.mentionAll ? 1 : 0
				}
			}
		}
		if (hasOptionalProperty(message, 'edit')) {
			m = {
				protocolMessage: {
					key: message.edit,
					editedMessage: m,
					timestampMs: Date.now(),
					type: WAProto.Message.ProtocolMessage.Type.MESSAGE_EDIT
				}
			}
		}
		if (hasOptionalProperty(message, 'contextInfo') && !!message.contextInfo) {
			const messageType = Object.keys(m)[0]
			const key = m[messageType]
			if ('contextInfo' in key && !!key.contextInfo) {
				key.contextInfo = Object.assign(Object.assign({}, key.contextInfo), message.contextInfo)
			} else if (key) {
				key.contextInfo = message.contextInfo
			}
		}
		if (hasOptionalProperty(message, 'albumParentKey') && !!message.albumParentKey) {
			m.messageContextInfo = Object.assign(Object.assign({}, m.messageContextInfo), {
				messageAssociation: {
					associationType: WAProto.MessageAssociation.AssociationType.MEDIA_ALBUM,
					parentMessageKey: message.albumParentKey
				}
			})
		}
		if (shouldIncludeReportingToken(m)) {
			m.messageContextInfo = m.messageContextInfo || {}
			if (!m.messageContextInfo.messageSecret) {
				m.messageContextInfo.messageSecret = randomBytes(32)
			}
		}
		return WAProto.Message.create(m)
	})
export const generateWAMessageFromContent = (jid, message, options) => {
	var _a
	// set timestamp to now
	// if not specified
	if (!options.timestamp) {
		options.timestamp = new Date()
	}
	const innerMessage = normalizeMessageContent(message)
	const key = getContentType(innerMessage)
	const timestamp = unixTimestampSeconds(options.timestamp)
	const { quoted, userJid } = options
	if (quoted && !isJidNewsletter(jid)) {
		const participant = quoted.key.fromMe
			? userJid // TODO: Add support for LIDs
			: quoted.participant || quoted.key.participant || quoted.key.remoteJid
		let quotedMsg = normalizeMessageContent(quoted.message)
		const msgType = getContentType(quotedMsg)
		// strip any redundant properties
		quotedMsg = proto.Message.create({ [msgType]: quotedMsg[msgType] })
		const quotedContent = quotedMsg[msgType]
		if (typeof quotedContent === 'object' && quotedContent && 'contextInfo' in quotedContent) {
			delete quotedContent.contextInfo
		}
		const contextInfo =
			('contextInfo' in innerMessage[key] &&
				((_a = innerMessage[key]) === null || _a === void 0 ? void 0 : _a.contextInfo)) ||
			{}
		contextInfo.participant = jidNormalizedUser(participant)
		contextInfo.stanzaId = quoted.key.id
		contextInfo.quotedMessage = quotedMsg
		// if a participant is quoted, then it must be a group
		// hence, remoteJid of group must also be entered
		if (jid !== quoted.key.remoteJid) {
			contextInfo.remoteJid = quoted.key.remoteJid
		}
		if (contextInfo && innerMessage[key]) {
			/* @ts-ignore */
			innerMessage[key].contextInfo = contextInfo
		}
	}
	if (
		// if we want to send a disappearing message
		!!(options === null || options === void 0 ? void 0 : options.ephemeralExpiration) &&
		// and it's not a protocol message -- delete, toggle disappear message
		key !== 'protocolMessage' &&
		// already not converted to disappearing message
		key !== 'ephemeralMessage' &&
		// newsletters don't support ephemeral messages
		!isJidNewsletter(jid)
	) {
		/* @ts-ignore */
		innerMessage[key].contextInfo = Object.assign(Object.assign({}, innerMessage[key].contextInfo || {}), {
			expiration: options.ephemeralExpiration || WA_DEFAULT_EPHEMERAL
		})
	}
	message = WAProto.Message.create(message)
	const messageJSON = {
		key: {
			remoteJid: jid,
			fromMe: true,
			id: (options === null || options === void 0 ? void 0 : options.messageId) || generateMessageIDV2()
		},
		message: message,
		messageTimestamp: timestamp,
		messageStubParameters: [],
		participant: isJidGroup(jid) || isJidStatusBroadcast(jid) ? userJid : undefined, // TODO: Add support for LIDs
		status: WAMessageStatus.PENDING
	}
	return WAProto.WebMessageInfo.fromObject(messageJSON)
}
export const generateWAMessage = (jid, content, options) =>
	__awaiter(void 0, void 0, void 0, function* () {
		var _a
		// ensure msg ID is with every log
		options.logger =
			(_a = options === null || options === void 0 ? void 0 : options.logger) === null || _a === void 0
				? void 0
				: _a.child({ msgId: options.messageId })
		// Pass jid in the options to generateWAMessageContent
		return generateWAMessageFromContent(
			jid,
			yield generateWAMessageContent(content, Object.assign(Object.assign({}, options), { jid })),
			options
		)
	})
/** Get the key to access the true type of content */
export const getContentType = content => {
	if (content) {
		const keys = Object.keys(content)
		const key = keys.find(k => (k === 'conversation' || k.includes('Message')) && k !== 'senderKeyDistributionMessage')
		return key
	}
}
/**
 * Normalizes ephemeral, view once messages to regular message content
 * Eg. image messages in ephemeral messages, in view once messages etc.
 * @param content
 * @returns
 */
export const normalizeMessageContent = content => {
	if (!content) {
		return undefined
	}
	// set max iterations to prevent an infinite loop
	for (let i = 0; i < 5; i++) {
		const inner = getFutureProofMessage(content)
		if (!inner) {
			break
		}
		content = inner.message
	}
	return content
	function getFutureProofMessage(message) {
		return (
			(message === null || message === void 0 ? void 0 : message.ephemeralMessage) ||
			(message === null || message === void 0 ? void 0 : message.viewOnceMessage) ||
			(message === null || message === void 0 ? void 0 : message.documentWithCaptionMessage) ||
			(message === null || message === void 0 ? void 0 : message.viewOnceMessageV2) ||
			(message === null || message === void 0 ? void 0 : message.viewOnceMessageV2Extension) ||
			(message === null || message === void 0 ? void 0 : message.editedMessage) ||
			(message === null || message === void 0 ? void 0 : message.associatedChildMessage) ||
			(message === null || message === void 0 ? void 0 : message.groupStatusMessage) ||
			(message === null || message === void 0 ? void 0 : message.groupStatusMessageV2)
		)
	}
}
/**
 * Extract the true message content from a message
 * Eg. extracts the inner message from a disappearing message/view once message
 */
export const extractMessageContent = content => {
	var _a, _b, _c, _d, _e, _f
	const extractFromTemplateMessage = msg => {
		if (msg.imageMessage) {
			return { imageMessage: msg.imageMessage }
		} else if (msg.documentMessage) {
			return { documentMessage: msg.documentMessage }
		} else if (msg.videoMessage) {
			return { videoMessage: msg.videoMessage }
		} else if (msg.locationMessage) {
			return { locationMessage: msg.locationMessage }
		} else {
			return {
				conversation:
					'contentText' in msg ? msg.contentText : 'hydratedContentText' in msg ? msg.hydratedContentText : ''
			}
		}
	}
	content = normalizeMessageContent(content)
	if (content === null || content === void 0 ? void 0 : content.buttonsMessage) {
		return extractFromTemplateMessage(content.buttonsMessage)
	}
	if (
		(_a = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _a === void 0
			? void 0
			: _a.hydratedFourRowTemplate
	) {
		return extractFromTemplateMessage(
			(_b = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _b === void 0
				? void 0
				: _b.hydratedFourRowTemplate
		)
	}
	if (
		(_c = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _c === void 0
			? void 0
			: _c.hydratedTemplate
	) {
		return extractFromTemplateMessage(
			(_d = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _d === void 0
				? void 0
				: _d.hydratedTemplate
		)
	}
	if (
		(_e = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _e === void 0
			? void 0
			: _e.fourRowTemplate
	) {
		return extractFromTemplateMessage(
			(_f = content === null || content === void 0 ? void 0 : content.templateMessage) === null || _f === void 0
				? void 0
				: _f.fourRowTemplate
		)
	}
	return content
}
/**
 * Returns the device predicted by message ID
 */
export const getDevice = id =>
	/^3A.{18}$/.test(id)
		? 'ios'
		: /^3E.{20}$/.test(id)
			? 'web'
			: /^(.{21}|.{32})$/.test(id)
				? 'android'
				: /^(3F|.{18}$)/.test(id)
					? 'desktop'
					: 'unknown'
/** Upserts a receipt in the message */
export const updateMessageWithReceipt = (msg, receipt) => {
	msg.userReceipt = msg.userReceipt || []
	const recp = msg.userReceipt.find(m => m.userJid === receipt.userJid)
	if (recp) {
		Object.assign(recp, receipt)
	} else {
		msg.userReceipt.push(receipt)
	}
}
/** Update the message with a new reaction */
export const updateMessageWithReaction = (msg, reaction) => {
	const authorID = getKeyAuthor(reaction.key)
	const reactions = (msg.reactions || []).filter(r => getKeyAuthor(r.key) !== authorID)
	reaction.text = reaction.text || ''
	reactions.push(reaction)
	msg.reactions = reactions
}
/** Update the message with a new poll update */
export const updateMessageWithPollUpdate = (msg, update) => {
	var _a, _b
	const authorID = getKeyAuthor(update.pollUpdateMessageKey)
	const reactions = (msg.pollUpdates || []).filter(r => getKeyAuthor(r.pollUpdateMessageKey) !== authorID)
	if (
		(_b = (_a = update.vote) === null || _a === void 0 ? void 0 : _a.selectedOptions) === null || _b === void 0
			? void 0
			: _b.length
	) {
		reactions.push(update)
	}
	msg.pollUpdates = reactions
}
/** Update the message with a new event response */
export const updateMessageWithEventResponse = (msg, update) => {
	const authorID = getKeyAuthor(update.eventResponseMessageKey)
	const responses = (msg.eventResponses || []).filter(r => getKeyAuthor(r.eventResponseMessageKey) !== authorID)
	responses.push(update)
	msg.eventResponses = responses
}
/**
 * Aggregates all poll updates in a poll.
 * @param msg the poll creation message
 * @param meId your jid
 * @returns A list of options & their voters
 */
export function getAggregateVotesInPollMessage({ message, pollUpdates }, meId) {
	var _a, _b, _c
	const opts =
		((_a = message === null || message === void 0 ? void 0 : message.pollCreationMessage) === null || _a === void 0
			? void 0
			: _a.options) ||
		((_b = message === null || message === void 0 ? void 0 : message.pollCreationMessageV2) === null || _b === void 0
			? void 0
			: _b.options) ||
		((_c = message === null || message === void 0 ? void 0 : message.pollCreationMessageV3) === null || _c === void 0
			? void 0
			: _c.options) ||
		[]
	const voteHashMap = opts.reduce((acc, opt) => {
		const hash = sha256(Buffer.from(opt.optionName || '')).toString()
		acc[hash] = {
			name: opt.optionName || '',
			voters: []
		}
		return acc
	}, {})
	for (const update of pollUpdates || []) {
		const { vote } = update
		if (!vote) {
			continue
		}
		for (const option of vote.selectedOptions || []) {
			const hash = option.toString()
			let data = voteHashMap[hash]
			if (!data) {
				voteHashMap[hash] = {
					name: 'Unknown',
					voters: []
				}
				data = voteHashMap[hash]
			}
			voteHashMap[hash].voters.push(getKeyAuthor(update.pollUpdateMessageKey, meId))
		}
	}
	return Object.values(voteHashMap)
}
/**
 * Aggregates all event responses in an event message.
 * @param msg the event creation message
 * @param meId your jid
 * @returns A list of response types & their responders
 */
export function getAggregateResponsesInEventMessage({ eventResponses }, meId) {
	const responseTypes = ['GOING', 'NOT_GOING', 'MAYBE']
	const responseMap = {}
	for (const type of responseTypes) {
		responseMap[type] = {
			response: type,
			responders: []
		}
	}
	for (const update of eventResponses || []) {
		const responseType = update.eventResponse || 'UNKNOWN'
		if (responseType !== 'UNKNOWN' && responseMap[responseType]) {
			responseMap[responseType].responders.push(getKeyAuthor(update.eventResponseMessageKey, meId))
		}
	}
	return Object.values(responseMap)
}
/** Given a list of message keys, aggregates them by chat & sender. Useful for sending read receipts in bulk */
export const aggregateMessageKeysNotFromMe = keys => {
	const keyMap = {}
	for (const { remoteJid, id, participant, fromMe } of keys) {
		if (!fromMe) {
			const uqKey = `${remoteJid}:${participant || ''}`
			if (!keyMap[uqKey]) {
				keyMap[uqKey] = {
					jid: remoteJid,
					participant: participant,
					messageIds: []
				}
			}
			keyMap[uqKey].messageIds.push(id)
		}
	}
	return Object.values(keyMap)
}
const REUPLOAD_REQUIRED_STATUS = [410, 404]
/**
 * Downloads the given message. Throws an error if it's not a media message
 */
export const downloadMediaMessage = (message, type, options, ctx) =>
	__awaiter(void 0, void 0, void 0, function* () {
		const result = yield downloadMsg().catch(error =>
			__awaiter(void 0, void 0, void 0, function* () {
				if (
					ctx &&
					typeof (error === null || error === void 0 ? void 0 : error.status) === 'number' && // treat errors with status as HTTP failures requiring reupload
					REUPLOAD_REQUIRED_STATUS.includes(error.status)
				) {
					ctx.logger.info({ key: message.key }, 'sending reupload media request...')
					// request reupload
					message = yield ctx.reuploadRequest(message)
					const result = yield downloadMsg()
					return result
				}
				throw error
			})
		)
		return result
		function downloadMsg() {
			return __awaiter(this, void 0, void 0, function* () {
				var _a, e_1, _b, _c
				const mContent = extractMessageContent(message.message)
				if (!mContent) {
					throw new Boom('No message present', { statusCode: 400, data: message })
				}
				const contentType = getContentType(mContent)
				let mediaType = contentType === null || contentType === void 0 ? void 0 : contentType.replace('Message', '')
				const media = mContent[contentType]
				if (!media || typeof media !== 'object' || (!('url' in media) && !('thumbnailDirectPath' in media))) {
					throw new Boom(`"${contentType}" message is not a media message`)
				}
				let download
				if ('thumbnailDirectPath' in media && !('url' in media)) {
					download = {
						directPath: media.thumbnailDirectPath,
						mediaKey: media.mediaKey
					}
					mediaType = 'thumbnail-link'
				} else {
					download = media
				}
				const stream = yield downloadContentFromMessage(download, mediaType, options)
				if (type === 'buffer') {
					const bufferArray = []
					try {
						for (
							var _d = true, stream_1 = __asyncValues(stream), stream_1_1;
							(stream_1_1 = yield stream_1.next()), (_a = stream_1_1.done), !_a;
							_d = true
						) {
							_c = stream_1_1.value
							_d = false
							const chunk = _c
							bufferArray.push(chunk)
						}
					} catch (e_1_1) {
						e_1 = { error: e_1_1 }
					} finally {
						try {
							if (!_d && !_a && (_b = stream_1.return)) yield _b.call(stream_1)
						} finally {
							if (e_1) throw e_1.error
						}
					}
					return Buffer.concat(bufferArray)
				}
				return stream
			})
		}
	})
/** Checks whether the given message is a media message; if it is returns the inner content */
export const assertMediaContent = content => {
	content = extractMessageContent(content)
	const mediaContent =
		(content === null || content === void 0 ? void 0 : content.documentMessage) ||
		(content === null || content === void 0 ? void 0 : content.imageMessage) ||
		(content === null || content === void 0 ? void 0 : content.videoMessage) ||
		(content === null || content === void 0 ? void 0 : content.audioMessage) ||
		(content === null || content === void 0 ? void 0 : content.stickerMessage)
	if (!mediaContent) {
		throw new Boom('given message is not a media message', { statusCode: 400, data: content })
	}
	return mediaContent
}
