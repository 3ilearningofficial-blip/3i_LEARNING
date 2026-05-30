/** Web-only LiveKit client — types for IDE when module resolution does not pick up node_modules. */
declare module "livekit-client" {
  export class Room {
    constructor(options?: { adaptiveStream?: boolean; dynacast?: boolean });
    connect(url: string, token: string): Promise<void>;
    disconnect(): Promise<void>;
    localParticipant: LocalParticipant;
    remoteParticipants: Map<string, RemoteParticipant>;
    on(event: RoomEvent, listener: () => void): void;
    off(event: RoomEvent, listener: () => void): void;
  }

  export enum RoomEvent {
    TrackSubscribed = "trackSubscribed",
    LocalTrackPublished = "localTrackPublished",
    Reconnecting = "reconnecting",
    Reconnected = "reconnected",
    Disconnected = "disconnected",
  }

  export namespace Track {
    export enum Source {
      Camera = "camera",
      Microphone = "microphone",
      ScreenShare = "screen_share",
    }
  }

  interface LocalParticipant {
    getTrackPublication(source: Track.Source): TrackPublication | undefined;
    setMicrophoneEnabled(enabled: boolean, options?: { deviceId?: string }): Promise<void>;
    setCameraEnabled(enabled: boolean, options?: { deviceId?: string }): Promise<void>;
    isMicrophoneEnabled: boolean;
    isCameraEnabled: boolean;
  }

  interface RemoteParticipant {
    getTrackPublication(source: Track.Source): TrackPublication | undefined;
  }

  interface TrackPublication {
    videoTrack?: { attach(element: HTMLVideoElement | HTMLAudioElement): void };
    audioTrack?: { attach(element: HTMLVideoElement | HTMLAudioElement): void };
  }
}
