import RNFS from 'react-native-fs'
import { Share } from 'react-native'
import { getApi } from '../../stores/auth/utils'

/**
 * A small on-device log of what the player does, so a playback problem on someone's phone can be
 * diagnosed. Release builds drop console output, so this is the only record. Nothing leaves the
 * device unless the user shares it from Settings > Developer.
 */
const JS_LOG_PATH = `${RNFS.CachesDirectoryPath}/jellify-playback.log`

/** Written by the native player (see patches/react-native-nitro-player+1.5.0.patch) */
const NATIVE_LOG_PATH = `${RNFS.CachesDirectoryPath}/nitroplayer.log`

const MAX_LOG_BYTES = 1_000_000
const SHARED_TAIL_BYTES = 150_000
const LINES_BETWEEN_SIZE_CHECKS = 100

let pendingWrites: Promise<void> = Promise.resolve()
let linesSinceSizeCheck = 0

/**
 * Removes what must not leave the device in a shared log: the server address, and API keys or
 * tokens (Jellyfin transcoding URLs carry one).
 */
export function redact(text: string, serverAddress: string | undefined): string {
	const withoutServer = serverAddress ? text.split(serverAddress).join('<server>') : text

	return withoutServer
		.replace(/(api_?key=)[^&\s"]+/gi, '$1<redacted>')
		.replace(/(token=")[^"]*/gi, '$1<redacted>')
		.replace(/(x-(emby|mediabrowser)-token[=:]\s*)[^&\s"]+/gi, '$1<redacted>')
}

/**
 * Describes a track URL for the log: whether there is one, and what it points at.
 */
export function describeUrl(url: string | undefined | null): string {
	if (!url) return 'NO URL'
	if (url.startsWith('file:') || url.startsWith('/')) return 'local file'
	return url
}

export function logPlayback(message: string): void {
	const line = `${new Date().toISOString()} ${redact(message, getApi()?.basePath)}\n`

	pendingWrites = pendingWrites
		.then(async () => {
			if (++linesSinceSizeCheck >= LINES_BETWEEN_SIZE_CHECKS) {
				linesSinceSizeCheck = 0
				if (
					(await RNFS.exists(JS_LOG_PATH)) &&
					Number((await RNFS.stat(JS_LOG_PATH)).size) > MAX_LOG_BYTES
				)
					await RNFS.unlink(JS_LOG_PATH)
			}
			await RNFS.appendFile(JS_LOG_PATH, line, 'utf8')
		})
		.catch(() => undefined)
}

async function readTail(path: string): Promise<string> {
	if (!(await RNFS.exists(path))) return '(empty)'

	const size = Number((await RNFS.stat(path)).size)
	const start = Math.max(0, size - SHARED_TAIL_BYTES)

	return RNFS.read(path, size - start, start, 'utf8')
}

/**
 * Opens the share sheet with the most recent part of the app and native player logs.
 */
export async function sharePlaybackLog(): Promise<void> {
	await pendingWrites

	const [appLog, nativeLog] = await Promise.all([
		readTail(JS_LOG_PATH).catch((error) => `(unreadable: ${error})`),
		readTail(NATIVE_LOG_PATH).catch((error) => `(unreadable: ${error})`),
	])

	const message = redact(
		`Jellify playback log\n\n=== app ===\n${appLog}\n\n=== native player ===\n${nativeLog}`,
		getApi()?.basePath,
	)

	await Share.share({ message })
}
