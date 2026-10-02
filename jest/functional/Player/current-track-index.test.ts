import { TrackItem } from 'react-native-nitro-player'
import { findCurrentTrackIndex } from '../../../src/player/utils/queue'

const queueOf = (...ids: string[]) => ids.map((id) => ({ id }) as TrackItem)

describe('findCurrentTrackIndex', () => {
	it('finds a track that is queued once', () => {
		expect(findCurrentTrackIndex(queueOf('a', 'b', 'c'), 'c', 0, 'skip')).toBe(2)
	})

	it('returns -1 for a track that is not in the queue', () => {
		expect(findCurrentTrackIndex(queueOf('a', 'b'), 'z', 0, 'skip')).toBe(-1)
		expect(findCurrentTrackIndex([], 'a', undefined)).toBe(-1)
	})

	describe('a song that is queued more than once', () => {
		it('moves on to the second copy when playback reaches it', () => {
			// a, b, a: the player moved from b on to the second a
			expect(findCurrentTrackIndex(queueOf('a', 'b', 'a'), 'a', 1, 'skip')).toBe(2)
		})

		it('keeps the copy the queue was just loaded on', () => {
			// started the queue from the second a: the store already points at it
			expect(findCurrentTrackIndex(queueOf('a', 'b', 'a'), 'a', 2, 'skip')).toBe(2)
			expect(findCurrentTrackIndex(queueOf('a', 'b', 'a'), 'a', 0, 'skip')).toBe(0)
		})

		it('picks the nearest earlier copy when skipping back', () => {
			// a, b, a, c: went back from c to the a before it, not to the first a
			expect(findCurrentTrackIndex(queueOf('a', 'b', 'a', 'c'), 'a', 3, 'skip')).toBe(2)
		})

		it('picks the next copy after the previous position, not one further on', () => {
			expect(findCurrentTrackIndex(queueOf('a', 'x', 'a', 'y', 'a'), 'a', 1, 'skip')).toBe(2)
			expect(findCurrentTrackIndex(queueOf('a', 'x', 'a', 'y', 'a'), 'a', 3, 'skip')).toBe(4)
		})

		it('goes back to the first copy when the queue repeats', () => {
			expect(findCurrentTrackIndex(queueOf('a', 'b', 'a'), 'a', 2, 'repeat')).toBe(0)
		})

		it('takes the first copy when there is no previous position', () => {
			expect(findCurrentTrackIndex(queueOf('a', 'b', 'a'), 'a', undefined, 'skip')).toBe(0)
		})
	})
})
