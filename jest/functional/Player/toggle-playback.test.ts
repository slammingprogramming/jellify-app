import { TrackPlayer } from 'react-native-nitro-player'
import { hasTrackEnded, togglePlayback } from '../../../src/player/controls/playback'

jest.mock('../../../src/utils/haptics', () => ({ applyHapticFeedback: jest.fn() }))

describe('togglePlayback', () => {
	beforeEach(() => jest.clearAllMocks())

	it('resumes where it paused when the player does not know the duration (transcoded stream)', async () => {
		;(TrackPlayer.getState as jest.Mock).mockResolvedValue({
			currentState: 'paused',
			totalDuration: 0,
			currentPosition: 42,
		})

		await togglePlayback()

		expect(TrackPlayer.seek).not.toHaveBeenCalled()
		expect(TrackPlayer.play).toHaveBeenCalled()
	})

	it('starts the track over when it has played to its end', async () => {
		;(TrackPlayer.getState as jest.Mock).mockResolvedValue({
			currentState: 'stopped',
			totalDuration: 180,
			currentPosition: 180,
		})

		await togglePlayback()

		expect(TrackPlayer.seek).toHaveBeenCalledWith(0)
		expect(TrackPlayer.play).toHaveBeenCalled()
	})

	it('pauses when playing', async () => {
		;(TrackPlayer.getState as jest.Mock).mockResolvedValue({
			currentState: 'playing',
			totalDuration: 0,
			currentPosition: 42,
		})

		await togglePlayback()

		expect(TrackPlayer.pause).toHaveBeenCalled()
		expect(TrackPlayer.seek).not.toHaveBeenCalled()
	})
})

describe('hasTrackEnded', () => {
	it('is false while the duration is unknown', () => {
		expect(hasTrackEnded(0, 42)).toBe(false)
	})

	it('is true at or past a known duration', () => {
		expect(hasTrackEnded(180, 180)).toBe(true)
		expect(hasTrackEnded(180, 90)).toBe(false)
	})
})
