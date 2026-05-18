/** Server-side LiveKit SDK — types for IDE when module resolution does not pick up node_modules. */
declare module "livekit-server-sdk" {
  export interface AccessTokenOptions {
    identity: string;
    name?: string;
    ttl?: string | number;
  }

  export interface VideoGrant {
    roomJoin?: boolean;
    room?: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
  }

  export class AccessToken {
    constructor(apiKey: string, apiSecret: string, options: AccessTokenOptions);
    addGrant(grant: VideoGrant): void;
    toJwt(): Promise<string>;
  }
}
