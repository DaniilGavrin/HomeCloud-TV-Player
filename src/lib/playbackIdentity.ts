/** Identity fence shared by media decoder events and room control. */
export type PlaybackIdentity = {
  room_id: string;
  playback_id: string;
  generation: number;
};

export function matchesPlaybackIdentity(
  dataset: DOMStringMap,
  current: PlaybackIdentity,
): boolean {
  return dataset.roomId === current.room_id &&
    dataset.playbackId === current.playback_id &&
    Number(dataset.generation) === current.generation;
}
