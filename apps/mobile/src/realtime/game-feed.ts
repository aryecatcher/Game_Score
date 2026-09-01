import { RealtimeServerMessageSchema, type Id, type RealtimeServerMessage } from "@gamechanger/contracts";
import { mobileConfig } from "../config.js";

export class GameFeed {
  private socket: WebSocket | undefined;

  connect(token: string, gameId: Id, afterSequence: number, onMessage: (message: RealtimeServerMessage) => void): void {
    this.close();
    const socket = new WebSocket(mobileConfig.realtimeUrl);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "AUTH", token }));
      socket.send(JSON.stringify({ type: "SUBSCRIBE_GAME", gameId, afterSequence }));
    };
    socket.onmessage = (event) => {
      const parsed = RealtimeServerMessageSchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success) onMessage(parsed.data);
    };
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}
