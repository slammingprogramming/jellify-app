import { isNull, isUndefined } from 'lodash'
import { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { networkStatusTypes } from '../../components/Network/internetConnectionWatcher'
import { DownloadedTrack, PlayerQueue, Reason, TrackItem } from 'react-native-nitro-player'

export async function clearPlaylists() {
	await Promise.all(
		PlayerQueue.getAllPlaylists().map((playlist) => {
			return PlayerQueue.deletePlaylist(playlist.id)
		}),
	)
}

export function filterTracksOnNetworkStatus(
	networkStatus: networkStatusTypes | undefined | null,
	queuedItems: BaseItemDto[],
	downloadedTracks: DownloadedTrack[],
) {
	if (
		isUndefined(networkStatus) ||
		isNull(networkStatus) ||
		networkStatus === networkStatusTypes.ONLINE
	)
		return queuedItems
	else
		return queuedItems.filter((item) =>
			downloadedTracks.map((download) => download.trackId).includes(item.Id!),
		)
}

/**
 * Finds the position in the queue of the track the player just switched to.
 *
 * The player only reports which track is playing, not which entry of the queue it is. That is
 * ambiguous when a song is queued more than once, and always taking the first match would put the
 * current position on the wrong copy (the queue would scroll to it, and what plays next would be
 * worked out from it). Use where playback came from to pick the right copy instead.
 *
 * @param queue The queue, in playing order
 * @param trackId The ID of the track the player switched to
 * @param previousIndex The position that was current before the switch
 * @param reason Why the player switched tracks
 * @returns The position of the track in the queue, or `-1` if it is not in the queue
 */
export function findCurrentTrackIndex(
	queue: TrackItem[],
	trackId: string,
	previousIndex: number | undefined,
	reason?: Reason,
): number {
	const matches = queue.reduce<number[]>((indexes, track, index) => {
		if (track.id === trackId) indexes.push(index)
		return indexes
	}, [])

	if (matches.length <= 1) return matches[0] ?? -1

	// The queue starts over from its first entry
	if (reason === 'repeat' || previousIndex === undefined) return matches[0]

	// That copy is already the current one, e.g. the queue was just loaded starting from it
	if (matches.includes(previousIndex)) return previousIndex

	// Playback moves forward: take the next copy ahead of where we were
	const next = matches.find((index) => index > previousIndex)
	if (next !== undefined) return next

	// Otherwise we went back: take the nearest copy behind
	return matches[matches.length - 1]
}
