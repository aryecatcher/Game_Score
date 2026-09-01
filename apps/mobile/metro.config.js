import path from "node:path";
import { getDefaultConfig, mergeConfig } from "@react-native/metro-config";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

export default mergeConfig(getDefaultConfig(import.meta.dirname), {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(workspaceRoot, "node_modules"), path.resolve(import.meta.dirname, "node_modules")]
  }
});
