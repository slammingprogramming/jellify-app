import Toast from 'react-native-toast-message'
import { Reason, TrackItem, TrackPlayerState } from 'react-native-nitro-player'
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models'
import { getTrackMediaSourceInfo } from '../../../utils/mapping/track-extra-payload'
import { captureWarning } from '../../../utils/logging'
import LoggingContext from '../../../utils/logging/enums'

/**
 * How long the player may sit buffering before we tell the user, in milliseconds.
 */
export const STUCK_BUFFERING_TIMEOUT = 20_000

let stuckBufferingTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Describes what is being played in a few words, e.g. "flac, direct" or "opus, transcoded".
 * When a track won't play, this is the first thing needed to tell why.
 *
 * @param track The {@link TrackItem} that is playing
 */
export function describePlaybackSource(track: TrackItem): string {
	const source = getTrackMediaSourceInfo(track)

	const codec = source?.MediaStreams?.find(
		(stream) => stream.Type === MediaStreamType.Audio,
	)?.Codec
	const format = codec ?? source?.Container ?? 'unknown format'

	return `${format}, ${source?.TranscodingUrl ? 'transcoded' : 'direct'}`
}

/**
 * Tells the user when playback fails or gets stuck buffering, instead of leaving them
 * staring at a spinner. Call on every playback state change.
 *
 * @param state The new {@link TrackPlayerState}
 * @param reason The {@link Reason} for the change, if any
 * @param track The {@link TrackItem} that is current
 */
export function reportPlaybackDiagnostics(
	state: TrackPlayerState,
	reason: Reason | undefined,
	track: TrackItem,
): void {
	clearTimeout(stuckBufferingTimer)
	stuckBufferingTimer = undefined

	if (state === 'stopped' && reason === 'error') {
		const source = describePlaybackSource(track)

		captureWarning(LoggingContext.NitroPlayer, `Playback failed: ${track.title} (${source})`)
		Toast.show({
			type: 'error',
			text1: "Couldn't play this track",
			text2: `${track.title} (${source})`,
		})
	} else if (state === 'buffering') {
		stuckBufferingTimer = setTimeout(() => {
			Toast.show({
				type: 'info',
				text1: 'Still buffering',
				text2: `${track.title} (${describePlaybackSource(track)})`,
			})
		}, STUCK_BUFFERING_TIMEOUT)
	}
}
