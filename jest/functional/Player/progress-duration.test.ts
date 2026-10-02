import { TrackItem } from 'react-native-nitro-player'
import {
	onChangeTrack,
	onPlaybackProgress,
} from '../../../src/services/player/utils/event-handlers'
import { resolveTotalDuration } from '../../../src/player'
import { usePlayerDurationStore } from '../../../src/stores/player/duration'
import { usePlayerQueueStore } from '../../../src/stores/player/queue'
import reportPlaybackCompleted from '../../../src/api/mutations/playback/functions/playback-completed'
import handleAutoDownload from '../../../src/services/player/utils/auto-download'

jest.mock('../../../src/stores/player/queue', () => ({
	usePlayerQueueStore: { getState: jest.fn(), setState: jest.fn() },
	updateQueueTracks: jest.fn(),
}))

jest.mock('../../../src/stores/player/playback', () => ({
	usePlayerPlaybackStore: {
		getState: jest.fn().mockReturnValue({ position: 0 }),
		setState: jest.fn(),
	},
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
jest.mock('../../../src/utils/audio/normalization', () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../src/services/player/utils/auto-download', () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
}))

const METADATA_DURATION = 300

const track = {
	id: 'track-1',
	title: 'Track',
	artist: 'Artist',
	album: 'Album',
	duration: METADATA_DURATION,
	url: 'https://example.com/track-1',
	extraPayload: {},
} as unknown as TrackItem

// onPlaybackProgress ignores repeated positions, so every call in this file uses a new one
let nextPosition = 1
const tick = () => (nextPosition += 1)

describe('resolveTotalDuration', () => {
	it('prefers the duration measured by the player over the metadata', () => {
		expect(resolveTotalDuration(215.4, 300)).toBe(215.4)
	})

	it('falls back to the metadata while the player does not know the duration', () => {
		expect(resolveTotalDuration(0, 300)).toBe(300)
	})

	it('is 0 when neither is known', () => {
		expect(resolveTotalDuration(0, undefined)).toBe(0)
	})
})

describe('playback progress duration handling', () => {
	beforeEach(async () => {
		jest.clearAllMocks()
		;(usePlayerQueueStore.getState as jest.Mock).mockReturnValue({
			queue: [track],
			currentIndex: 0,
		})

		// A track change clears the "already reported as listened to" flag the handlers keep
		await onChangeTrack(track)
		usePlayerDurationStore.setState({ duration: 0 })
		jest.clearAllMocks()
	})

	it('records the duration measured by the player', async () => {
		await onPlaybackProgress(tick(), 187.5)

		expect(usePlayerDurationStore.getState().duration).toBe(187.5)
	})

	it('does not report the track as listened to when the player has no duration yet', async () => {
		// 5s into a 300s track, but the player reports an unknown (0) duration
		await onPlaybackProgress(tick(), 0)

		expect(reportPlaybackCompleted).not.toHaveBeenCalled()
	})

	it('hands auto-download the metadata duration instead of 0 when the player has none', async () => {
		const position = tick()

		await onPlaybackProgress(position, 0)

		expect(handleAutoDownload).toHaveBeenCalledWith(position, METADATA_DURATION, track)
	})

	it('falls back to the metadata duration to detect that a track was listened to', async () => {
		// 2/3 of the 300s metadata duration is 200s
		await onPlaybackProgress(250.5, 0)

		expect(reportPlaybackCompleted).toHaveBeenCalledWith(track)
	})

	it('uses the player duration, not the metadata, to detect that a track was listened to', async () => {
		// Metadata says 300s (2/3 = 200s), but the audio is really 100s long (2/3 = 66.7s)
		await onPlaybackProgress(70.25, 100)

		expect(reportPlaybackCompleted).toHaveBeenCalledWith(track)
	})

	it('forgets the previous track duration when the track changes', async () => {
		usePlayerDurationStore.setState({ duration: 187.5 })
		;(usePlayerQueueStore.getState as jest.Mock).mockReturnValue({
			queue: [track],
			currentIndex: 0,
		})

		await onChangeTrack(track)

		expect(usePlayerDurationStore.getState().duration).toBe(0)
	})
})
