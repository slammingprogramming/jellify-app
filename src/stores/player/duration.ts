import { create } from 'zustand'

type PlayerDurationStore = {
	/**
	 * The duration (in seconds) of the current track as measured by the native player,
	 * or `0` if the player does not (yet) know it.
	 *
	 * This is intentionally not persisted: it is only valid for the item currently loaded
	 * in the native player.
	 */
	duration: number
}

export const usePlayerDurationStore = create<PlayerDurationStore>()(() => ({
	duration: 0,
}))

export const useNativeDuration = () => usePlayerDurationStore((state) => state.duration)
