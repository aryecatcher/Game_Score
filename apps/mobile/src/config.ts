declare global {
  // Injected by the native host or a local bootstrap file. Never embed production secrets here.
  var __GAMECHANGER_CONFIG__: { apiBaseUrl?: string; realtimeUrl?: string } | undefined;
}

export const mobileConfig = {
  apiBaseUrl: globalThis.__GAMECHANGER_CONFIG__?.apiBaseUrl ?? "http://127.0.0.1:4100",
  realtimeUrl: globalThis.__GAMECHANGER_CONFIG__?.realtimeUrl ?? "ws://127.0.0.1:4101"
};
