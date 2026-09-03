import type {
  GameEventsResponse,
  GameSnapshot,
  Id,
  RealtimeServerMessage,
  ScoreEvent
} from "@gamechanger/contracts";
import { projectScore } from "@gamechanger/domain";

export interface LiveScoreApi {
  events(gameId: Id, afterSequence?: number): Promise<GameEventsResponse>;
}

export interface GameFeedPort {
  connect(token: string, gameId: Id, afterSequence: number, onMessage: (message: RealtimeServerMessage) => void): void;
  close(): void;
}

export type LiveScoreStatus =
  | { type: "CONNECTING" }
  | { type: "LIVE"; latestSequence: number }
  | { type: "RECOVERING"; requestedSequence: number }
  | { type: "ERROR"; code: string; message: string };

export interface LiveScoreObserver {
  onSnapshot(snapshot: GameSnapshot): void;
  onStatus?(status: LiveScoreStatus): void;
}

export class LiveScoreFollower {
  private events: ScoreEvent[] = [];
  private latestSequence = 0;
  private recovery: Promise<void> | undefined;
  private active = false;

  constructor(
    private readonly api: LiveScoreApi,
    private readonly feed: GameFeedPort,
    private readonly token: string,
    private readonly gameId: Id,
    private readonly observer: LiveScoreObserver
  ) {}

  async start(): Promise<void> {
    this.active = true;
    this.observer.onStatus?.({ type: "CONNECTING" });
    await this.reloadCanonicalEvents();
    if (!this.active) return;
    this.connectFeed();
  }

  stop(): void {
    this.active = false;
    this.feed.close();
  }

  private async handle(message: RealtimeServerMessage): Promise<void> {
    if (!this.active) return;
    if (message.type === "ERROR") {
      this.observer.onStatus?.({ type: "ERROR", code: message.code, message: message.message });
      return;
    }
    if (message.type === "SNAPSHOT_REQUIRED") {
      await this.recover(message.latestSequence);
      return;
    }
    if (message.type !== "SCORE_EVENT") return;
    if (message.event.gameId !== this.gameId) return;
    if (message.event.sequence <= this.latestSequence) return;
    if (message.event.sequence !== this.latestSequence + 1) {
      await this.recover(message.event.sequence);
      return;
    }
    this.events.push(message.event);
    this.latestSequence = message.event.sequence;
    this.emitSnapshot();
  }

  private async recover(requestedSequence: number): Promise<void> {
    if (this.recovery) return this.recovery;
    this.observer.onStatus?.({ type: "RECOVERING", requestedSequence });
    this.recovery = this.reloadCanonicalEvents().then(() => {
      if (this.active) this.connectFeed();
    }).finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }

  private connectFeed(): void {
    this.feed.connect(this.token, this.gameId, this.latestSequence, (message) => {
      void this.handle(message).catch((error: unknown) => {
        this.observer.onStatus?.({
          type: "ERROR",
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Realtime recovery failed."
        });
      });
    });
  }

  private async reloadCanonicalEvents(): Promise<void> {
    const response = await this.api.events(this.gameId, 0);
    if (!this.active) return;
    this.events = [...response.events].sort((a, b) => a.sequence - b.sequence);
    this.latestSequence = response.latestSequence;
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.observer.onSnapshot(projectScore(this.gameId, this.events));
    this.observer.onStatus?.({ type: "LIVE", latestSequence: this.latestSequence });
  }
}
