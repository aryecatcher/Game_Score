import type { Id } from "@gamechanger/contracts";
import { authorize, DomainError } from "@gamechanger/domain";
import type { PlatformStore } from "./memory-store.js";
import type { VideoProvider } from "./video-provider.js";

export class PlaybackService {
  constructor(private readonly store: PlatformStore, private readonly provider: VideoProvider) {}

  async authorize(accountId: Id, gameId: Id): Promise<{ playbackUrl: string; token: string; expiresInSeconds: number }> {
    const game = await this.store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    const decision = authorize({
      accountId,
      action: "PLAYBACK_AUTHORIZE",
      game,
      grants: await this.store.listGrants(accountId),
      membershipActive: true,
      consentSatisfied: true,
      contentBlocked: false
    });
    if (!decision.allowed) throw new DomainError(decision.reason, "Playback is not authorized.", 403);
    const stream = await this.store.findStreamByGame(gameId);
    if (!stream || stream.status === "BLOCKED") throw new DomainError("CONTENT_BLOCKED", "No playable stream is available.", 404);
    const expiresInSeconds = 120;
    return {
      playbackUrl: stream.playbackUrl,
      token: await this.provider.createPlaybackToken(stream.providerStreamId, accountId, expiresInSeconds),
      expiresInSeconds
    };
  }
}
