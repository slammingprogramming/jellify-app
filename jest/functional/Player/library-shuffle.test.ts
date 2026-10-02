import { DownloadedTrack, PlayerQueue, TrackItem } from 'react-native-nitro-player'
import { handleLibraryShuffle } from '../../../src/player/controls/shuffle'
import { ensureDownloadedTracks } from '../../../src/hooks/downloads/utils'

jest.mock('../../../src/hooks/downloads/utils', () => ({
	ensureDownloadedTracks: jest.fn(),
}))

jest.mock('../../../src/stores/auth/utils', () => ({
	getApi: jest.fn().mockReturnValue({}),
	getUser: jest.fn().mockReturnValue({ id: 'user-1' }),
	getLibrary: jest.fn().mockReturnValue({ musicLibraryId: 'library-1' }),
}))

jest.mock('../../../src/stores/device-profile', () => ({
	useStreamingDeviceProfileStore: {
		getState: () => ({ deviceProfile: { Id: 'profile-id' } }),
	},
}))

jest.mock('../../../src/stores/library', () => ({
	__esModule: true,
	default: {
		getState: () => ({ filters: { tracks: { isDownloaded: true } } }),
	},
}))

jest.mock('../../../src/stores/player/queue', () => ({
	usePlayerQueueStore: {
		getState: jest.fn().mockReturnValue({ setUnshuffledQueue: jest.fn() }),
		setState: jest.fn(),
	},
	setNewQueue: jest.fn(),
}))

jest.mock('../../../src/utils/logging', () => ({
	captureError: jest.fn(),
	captureInfo: jest.fn(),
	captureWarning: jest.fn(),
}))

const trackItem = (id: string): TrackItem =>
	({
		id,
		title: `Track ${id}`,
		artist: 'Artist',
		album: 'Album',
		duration: 180,
		url: `https://jellyfin.example.com/Audio/${id}/stream`,
		extraPayload: { item: JSON.stringify({ Id: id }), sessionId: '', mediaSourceInfo: '{}' },
	}) as TrackItem

const download = (id: string): DownloadedTrack =>
	({
		trackId: id,
		originalTrack: trackItem(id),
		localPath: `/var/mobile/downloads/${id}.mp3`,
		downloadedAt: 0,
		fileSize: 1,
	}) as DownloadedTrack

describe('handleLibraryShuffle with the "downloaded" filter', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		;(PlayerQueue.createPlaylist as jest.Mock).mockResolvedValue('shuffle-playlist')
		;(PlayerQueue.addTracksToPlaylist as jest.Mock).mockResolvedValue(undefined)
		;(PlayerQueue.loadPlaylist as jest.Mock).mockResolvedValue(undefined)
	})

	it('queues playable TrackItems, not raw DownloadedTrack records', async () => {
		;(ensureDownloadedTracks as jest.Mock).mockResolvedValue([
			download('a'),
			download('b'),
			download('c'),
		])

		const result = await handleLibraryShuffle()

		const queued = (PlayerQueue.addTracksToPlaylist as jest.Mock).mock
			.calls[0][1] as TrackItem[]

		// The native player requires id/title/url on every item it is given
		expect(queued).toHaveLength(3)
		queued.forEach((track) => {
			expect(typeof track.id).toBe('string')
			expect(typeof track.title).toBe('string')
			expect(typeof track.url).toBe('string')
		})
		expect(queued.map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
		expect(result?.queue.map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
	})
})
