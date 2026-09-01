import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  appendEvent(serializedEvent: string): Promise<void>;
  listPendingEvents(gameId: string, limit: number): Promise<string>;
  markEventsSynced(serializedClientEventIds: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>("NativeScoreEventStore");
