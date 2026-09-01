import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  requestPermissions(): Promise<boolean>;
  startBroadcast(ingestUrl: string, authToken: string): Promise<void>;
  stopBroadcast(): Promise<void>;
  currentState(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>("NativeBroadcastSession");
