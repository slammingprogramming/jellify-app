// Google Cast removed — casting is handled natively by nitro-player, whose
// playback-state events already reflect remote playback while casting.
// import { useEffect, useState } from 'react'
// import { usePlayerEngine } from '../../stores/player/engine'
// import { PlayerEngine } from '../../enums/player-engine'
// import { MediaPlayerState, useRemoteMediaClient } from 'react-native-google-cast'
import { TrackPlayerState, useOnPlaybackStateChange } from 'react-native-nitro-player'
import { usePlaybackPosition } from '../stores/player/playback'
import { useNativeDuration } from '../stores/player/duration'
import { useCurrentTrack } from '../stores/player/queue'

interface UseProgressResult {
	position: number
	totalDuration: number
}

/**
 * Picks the duration to display for the current track.
 *
 * The position always comes from the native player, so the length has to as well - the
 * duration stored in the Jellyfin metadata (`RunTimeTicks`) does not always match the audio
 * that is actually streamed, which makes the position run past the displayed length.
 * The metadata duration is only used until the player has measured the real one.
 *
 * @param nativeDuration The duration measured by the native player, `0` if unknown
 * @param metadataDuration The duration from the track's metadata
 */
export const resolveTotalDuration = (
	nativeDuration: number,
	metadataDuration: number | undefined,
): number => (nativeDuration > 0 ? nativeDuration : metadataDuration || 0)

export const useProgress = (): UseProgressResult => {
	const position = usePlaybackPosition()
	const nativeDuration = useNativeDuration()
	const totalDuration = resolveTotalDuration(nativeDuration, useCurrentTrack()?.duration)

	return {
		position,
		totalDuration,
	}
}

// --- Google Cast remote-client → player-state mapping (commented out) ---
// const castToPlayerState = (state: MediaPlayerState): TrackPlayerState => {
// 	switch (state) {
// 		case MediaPlayerState.PLAYING:
// 			return 'playing'
// 		case MediaPlayerState.PAUSED:
// 			return 'paused'
// 		default:
// 			return 'stopped'
// 	}
// }

export const usePlaybackState = (): TrackPlayerState | undefined => {
	const { state } = useOnPlaybackStateChange()

	// nitro-player emits the remote player's state while casting, so no special
	// Google Cast handling is needed here anymore.
	return state
}
