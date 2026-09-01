import { randomUUID } from "node:crypto";
import type { Id } from "@gamechanger/contracts";

export interface VideoSessionProvision {
  providerStreamId: string;
  ingestUrl: string;
  playbackUrl: string;
}

export interface VideoProvider {
  readonly name: "mock" | "aws-ivs" | "mux";
  createSession(gameId: Id): Promise<VideoSessionProvision>;
  createPlaybackToken(providerStreamId: string, accountId: Id, ttlSeconds: number): Promise<string>;
}

export class MockVideoProvider implements VideoProvider {
  readonly name = "mock" as const;
  async createSession(gameId: Id): Promise<VideoSessionProvision> {
    const providerStreamId = `mock-${randomUUID()}`;
    return {
      providerStreamId,
      ingestUrl: `mock://ingest/${gameId}/${providerStreamId}`,
      playbackUrl: `https://example.invalid/mock-playback/${providerStreamId}/index.m3u8`
    };
  }
  async createPlaybackToken(providerStreamId: string, accountId: Id, ttlSeconds: number): Promise<string> {
    return Buffer.from(JSON.stringify({ providerStreamId, accountId, ttlSeconds, mock: true })).toString("base64url");
  }
}
