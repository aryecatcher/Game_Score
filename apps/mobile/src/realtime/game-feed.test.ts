import { afterEach, describe, expect, it, vi } from "vitest";
import { GameFeed } from "./game-feed.js";

class FakeWebSocket {
  static latest: FakeWebSocket | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  constructor(_url: string | URL) {
    FakeWebSocket.latest = this;
  }

  send(message: string): void { this.sent.push(message); }
  close(): void {}
}

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.latest = undefined;
});

describe("GameFeed", () => {
  it("ignores malformed server frames instead of crashing the app", () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const onMessage = vi.fn();
    new GameFeed().connect(
      "dev-token",
      "20000000-0000-4000-8000-000000000001",
      0,
      onMessage
    );

    const socket = FakeWebSocket.latest!;
    expect(() => socket.onmessage?.({ data: "not-json" })).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();

    socket.onmessage?.({ data: JSON.stringify({ type: "AUTH_PENDING" }) });
    expect(onMessage).toHaveBeenCalledWith({ type: "AUTH_PENDING" });
  });
});
