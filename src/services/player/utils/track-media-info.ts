import { updateQueueTracks } from '../../../stores/player/queue'
import resolveTrackUrls from '../../../utils/fetching/track-media-info'
import { TrackItem, TrackPlayer } from 'react-native-nitro-player'

/**
 * Core URL-resolution logic. Fetches fresh playback info for each track,
 * builds updated track objects, calls TrackPlayer.updateTracks and syncs
 * the JS queue store. Has no guards — callers are responsible for gating.
 */
export async function updateTrackMediaInfo(
	tracks: TrackItem[],
	signal?: AbortSignal,
): Promise<void> {
	const updatedTracks = await resolveTrackUrls(tracks, 'stream')

	// A newer update superseded this one while we were resolving. We only skip applying the
	// result here - the requests themselves are never cancelled, because they are shared with
	// (and cached for) the newer update.
	if (signal?.aborted) return

	await TrackPlayer.updateTracks(updatedTracks)

	updateQueueTracks(updatedTracks)
}
