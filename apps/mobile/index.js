import { AppRegistry } from "react-native";
import App from "./src/App";
import { name as appName } from "./app.json" with { type: "json" };

AppRegistry.registerComponent(appName, () => App);
