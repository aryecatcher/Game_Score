import { randomUUID } from "node:crypto";
import type { Id } from "@gamechanger/contracts";
import { authorize, DomainError, type StreamSession } from "@gamechanger/domain";
import type { PlatformStore } from "./memory-store.js";
import type { VideoProvider } from "./video-provider.js";

export class StreamService {
  constructor(private readonly store: PlatformStore, private readonly provider: VideoProvider, private readonly now = () => new Date()) {}

  async start(accountId: Id, gameId: Id): Promise<StreamSession> {
    const game = await this.store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    const decision = authorize({ accountId, action: "STREAM_START", game, grants: await this.store.listGrants(accountId) });
    if (!decision.allowed) throw new DomainError("STREAM_ROLE_MISSING", "Account cannot start a stream for this game.", 403);
    const existing = await this.store.findStreamByGame(gameId);
    if (existing) return existing;
    const provision = await this.provider.createSession(gameId);
    const stream: StreamSession = {
      id: randomUUID() as Id,
      gameId,
      startedBy: accountId,
      provider: this.provider.name,
      providerStreamId: provision.providerStreamId,
      status: "CREATED",
      ingestUrl: provision.ingestUrl,
      playbackUrl: provision.playbackUrl,
      createdAt: this.now().toISOString()
    };
    await this.store.saveStream(stream);
    return stream;
  }
}
