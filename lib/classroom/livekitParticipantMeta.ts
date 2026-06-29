import type { LocalParticipant, RemoteParticipant, Room } from "livekit-client";

type ParticipantWithMeta = {
  metadata?: string;
  setMetadata?: (metadata: string) => Promise<void>;
};

/** RoomEvent.ParticipantMetadataChanged — string literal for older @types exports. */
export const LIVEKIT_PARTICIPANT_METADATA_CHANGED = "participantMetadataChanged" as const;

/** Track lifecycle events — string literals for livekit-client versions without full RoomEvent typings. */
export const LIVEKIT_TRACK_UNPUBLISHED = "trackUnpublished" as const;
export const LIVEKIT_TRACK_MUTED = "trackMuted" as const;
export const LIVEKIT_TRACK_UNMUTED = "trackUnmuted" as const;

export async function publishTeacherStreamMeta(room: Room, payload: string): Promise<void> {
  const lp = room.localParticipant as LocalParticipant & ParticipantWithMeta;
  if (typeof lp.setMetadata === "function") {
    await lp.setMetadata(payload);
  }
}

export function readParticipantMeta(participant: RemoteParticipant): string | undefined {
  return (participant as RemoteParticipant & ParticipantWithMeta).metadata;
}
