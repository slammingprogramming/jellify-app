import { TrackItem, TrackPlayer } from 'react-native-nitro-player'
import { Platform } from 'react-native'
import { onTracksNeedUpdate } from '../../../src/services/player/utils/event-handlers'
import { queryClient } from '../../../src/constants/query-client'
import { fetchMediaInfo } from '../../../src/api/queries/media/utils'

/**
 * Only the network call is faked. The real URL resolution + React Query path
 * (`resolveTrackUrls` -> `ensureMediaInfoQuery` -> `ensureQueryData`) is exercised, because the
 * bug lives in how those interact with the AbortController in `onTracksNeedUpdate`.
 */
jest.mock('../../../src/api/queries/media/utils', () => ({
	fetchMediaInfo: jest.fn(),
}))

jest.mock('../../../src/stores/auth/utils', () => ({
	getApi: jest.fn().mockReturnValue({
		basePath: 'https://jellyfin.example.com',
		configuration: { basePath: 'https://jellyfin.example.com' },
	}),
}))

jest.mock('../../../src/stores/device-profile', () => {
	const profile = { Id: 'profile-id', Name: 'Test Profile' }
	return {
		useStreamingDeviceProfileStore: { getState: () => ({ deviceProfile: profile }) },
		useDownloadingDeviceProfileStore: { getState: () => ({ deviceProfile: profile }) },
	}
})

jest.mock('../../../src/stores/player/queue', () => ({
	usePlayerQueueStore: { getState: jest.fn() },
	updateQueueTracks: jest.fn(),
}))

jest.mock('../../../src/utils/logging', () => ({
	captureInfo: jest.fn(),
	captureError: jest.fn(),
	captureWarning: jest.fn(),
	LoggingContext: { MediaInfo: 'MediaInfo', AutoDownload: 'AutoDownload', Player: 'Player' },
}))

jest.mock('../../../src/api/mutations/playback/functions/playback-completed', () => ({
	__esModule: true,
	default: jest.fn(),
}))
jest.mock('../../../src/api/mutations/playback/functions/playback-progress', () => ({
	__esModule: true,
	default: jest.fn(),
}))
jest.mock('../../../src/api/mutations/playback/functions/playback-started', () => ({
	__esModule: true,
	default: jest.fn(),
}))
jest.mock('../../../src/stores/player/playback', () => ({
	usePlayerPlaybackStore: {
		getState: jest.fn().mockReturnValue({ position: 0 }),
		setState: jest.fn(),
	},
}))
jest.mock('../../../src/stores/settings/player', () => ({
	usePlayerSettingsStore: {
		getState: jest.fn().mockReturnValue({ enableAudioNormalization: false }),
	},
}))
jest.mock('../../../src/utils/audio/normalization', () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
	resetPlayerVolume: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../src/services/player/utils/auto-download', () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
}))

const SERVER_LATENCY_MS = 100

/** A fake Jellyfin server that, like axios, rejects as soon as its AbortSignal fires. */
function fakeServer(_profile: unknown, itemId: string, signal?: AbortSignal) {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer)
			reject(new Error('canceled'))
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve({
				PlaySessionId: `session-${itemId}`,
				MediaSources: [{ Container: 'mp3', RunTimeTicks: 1800000000 }],
			})
		}, SERVER_LATENCY_MS)
		if (signal?.aborted) return onAbort()
		signal?.addEventListener('abort', onAbort)
	})
}

const emptyUrlTrack = (id: string): TrackItem =>
	({
		id,
		title: id,
		artist: 'Artist',
		album: 'Album',
		duration: 180,
		url: '',
		extraPayload: {
			sessionId: '',
			mediaSourceInfo: '{}',
			item: JSON.stringify({ Id: id, Name: id }),
		},
	}) as TrackItem

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** All URLs that were ever handed to the native player via updateTracks, keyed by track id. */
const resolvedUrls = () => {
	const urls = new Map<string, string>()
	;(TrackPlayer.updateTracks as jest.Mock).mock.calls.forEach(([tracks]: [TrackItem[]]) =>
		tracks.forEach((t) => t.url && urls.set(t.id, t.url)),
	)
	return urls
}

describe('onTracksNeedUpdate overlapping native events (iOS)', () => {
	const originalOS = Platform.OS

	beforeEach(() => {
		jest.clearAllMocks()
		queryClient.clear()
		;(fetchMediaInfo as jest.Mock).mockImplementation(fakeServer)
		Platform.OS = 'ios'
	})

	afterEach(() => {
		Platform.OS = originalOS
	})

	it('control: resolves URLs when a single event is not interrupted', async () => {
		const first = onTracksNeedUpdate([emptyUrlTrack('current'), emptyUrlTrack('next')], 5)

		await sleep(SERVER_LATENCY_MS * 3)

		const urls = resolvedUrls()
		expect(urls.get('current')).toContain('/Audio/current/stream')
		expect(urls.get('next')).toContain('/Audio/next/stream')

		await first
	})

	it('still resolves a URL for the current track when a second event overlaps the first', async () => {
		const current = emptyUrlTrack('current')
		const next = emptyUrlTrack('next')

		// e.g. loadPlaylist() asks for URLs, then the native play()/item-change check asks again
		// a few ms later for the very same tracks.
		const first = onTracksNeedUpdate([current, next], 5)
		await sleep(20)
		const second = onTracksNeedUpdate([current, next], 5)

		// Comfortably longer than one server round trip, but far shorter than any retry backoff.
		await sleep(SERVER_LATENCY_MS * 3)

		const urls = resolvedUrls()
		expect(urls.get('current')).toContain('/Audio/current/stream')
		expect(urls.get('next')).toContain('/Audio/next/stream')

		await Promise.allSettled([first, second])
	})

	it('still resolves when the second event only partially overlaps the first', async () => {
		const a = emptyUrlTrack('a')
		const b = emptyUrlTrack('b')
		const c = emptyUrlTrack('c')

		const first = onTracksNeedUpdate([a, b], 5)
		await sleep(20)
		// Track change: `a` is now the previous track, so the new window is [b, c]
		const second = onTracksNeedUpdate([b, c], 5)

		await sleep(SERVER_LATENCY_MS * 3)

		const urls = resolvedUrls()
		expect(urls.get('b')).toContain('/Audio/b/stream')
		expect(urls.get('c')).toContain('/Audio/c/stream')

		await Promise.allSettled([first, second])
	})
})
