import type { LocalParticipant, RemoteParticipant, Room } from "livekit-client";

type ParticipantWithMeta = {
  metadata?: string;
  setMetadata?: (metadata: string) => Promise<void>;
};

/** RoomEvent.ParticipantMetadataChanged — string literal for older @types exports. */
export const LIVEKIT_PARTICIPANT_METADATA_CHANGED = "participantMetadataChanged" as const;

export async function publishTeacherStreamMeta(room: Room, payload: string): Promise<void> {
  const lp = room.localParticipant as LocalParticipant & ParticipantWithMeta;
  if (typeof lp.setMetadata === "function") {
    await lp.setMetadata(payload);
  }
}

export function readParticipantMeta(participant: RemoteParticipant): string | undefined {
  return (participant as RemoteParticipant & ParticipantWithMeta).metadata;
}
