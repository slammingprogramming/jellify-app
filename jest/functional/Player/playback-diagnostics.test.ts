import Toast from 'react-native-toast-message'
import { TrackItem } from 'react-native-nitro-player'
import {
	describePlaybackSource,
	reportPlaybackDiagnostics,
	STUCK_BUFFERING_TIMEOUT,
} from '../../../src/services/player/utils/playback-diagnostics'

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }))

jest.mock('../../../src/utils/logging', () => ({
	captureWarning: jest.fn(),
	captureError: jest.fn(),
	captureInfo: jest.fn(),
}))

const trackWith = (mediaSource: object): TrackItem =>
	({
		id: 't1',
		title: 'Some Song',
		extraPayload: { item: '{}', sessionId: '', mediaSourceInfo: JSON.stringify(mediaSource) },
	}) as unknown as TrackItem

const directFlac = trackWith({
	Container: 'flac',
	MediaStreams: [{ Type: 'Audio', Codec: 'flac' }],
})
const transcodedOpus = trackWith({
	Container: 'ogg',
	TranscodingUrl: '/Audio/t1/stream.aac',
	MediaStreams: [{ Type: 'Audio', Codec: 'opus' }],
})

describe('describePlaybackSource', () => {
	it('names the codec and says it is played directly', () => {
		expect(describePlaybackSource(directFlac)).toBe('flac, direct')
	})

	it('says when the server is transcoding', () => {
		expect(describePlaybackSource(transcodedOpus)).toBe('opus, transcoded')
	})

	it('falls back to the container, then to unknown', () => {
		expect(describePlaybackSource(trackWith({ Container: 'mp3' }))).toBe('mp3, direct')
		expect(describePlaybackSource(trackWith({}))).toBe('unknown format, direct')
	})
})

describe('reportPlaybackDiagnostics', () => {
	beforeEach(() => {
		jest.useFakeTimers()
		jest.clearAllMocks()
	})

	afterEach(() => {
		// leave no pending timer behind
		reportPlaybackDiagnostics('playing', undefined, directFlac)
		jest.useRealTimers()
	})

	it('tells the user when the player gives up on a track', () => {
		reportPlaybackDiagnostics('stopped', 'error', transcodedOpus)

		expect(Toast.show).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'error', text2: 'Some Song (opus, transcoded)' }),
		)
	})

	it('does not report a normal stop as a failure', () => {
		reportPlaybackDiagnostics('stopped', 'end', directFlac)
		reportPlaybackDiagnostics('paused', undefined, directFlac)

		expect(Toast.show).not.toHaveBeenCalled()
	})

	it('tells the user when buffering takes too long', () => {
		reportPlaybackDiagnostics('buffering', undefined, directFlac)

		jest.advanceTimersByTime(STUCK_BUFFERING_TIMEOUT - 1)
		expect(Toast.show).not.toHaveBeenCalled()

		jest.advanceTimersByTime(1)
		expect(Toast.show).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'info', text2: 'Some Song (flac, direct)' }),
		)
	})

	it('stays quiet when playback starts before the timeout', () => {
		reportPlaybackDiagnostics('buffering', undefined, directFlac)
		jest.advanceTimersByTime(5_000)
		reportPlaybackDiagnostics('playing', undefined, directFlac)

		jest.advanceTimersByTime(STUCK_BUFFERING_TIMEOUT * 2)
		expect(Toast.show).not.toHaveBeenCalled()
	})
})
