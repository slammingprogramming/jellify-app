import { usePlayerQueueStore } from '../../stores/player/queue'
import { TrackPlayer } from 'react-native-nitro-player'
import { applyHapticFeedback } from '../../utils/haptics'

/**
 * Whether the current track has played to its end, so resuming should start it over.
 *
 * The player reports a duration of `0` when it does not know it, which is normal for a stream
 * the server transcodes on the fly. That must not count as "ended": resuming would then restart
 * the track every time.
 */
export const hasTrackEnded = (totalDuration: number, position: number): boolean =>
	totalDuration > 0 && position >= totalDuration

export async function togglePlayback() {
	applyHapticFeedback('info')

	const { currentState, totalDuration, currentPosition } = await TrackPlayer.getState()

	if (currentState === 'playing') return await TrackPlayer.pause()

	if (hasTrackEnded(totalDuration, currentPosition)) await TrackPlayer.seek(0)

	return await TrackPlayer.play()
}
