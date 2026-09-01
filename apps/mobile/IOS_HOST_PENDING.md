# iOS Host 待生成

当前仓库已包含 React Native 页面、同步引擎和 Turbo Native Module TypeScript 规范，但没有猜测性生成 Xcode 工程。

待 Bundle ID、Apple Team ID、最低 iOS 版本确认后，在 macOS 上用官方 Community CLI 的对应 React Native 版本生成原生 host，再合入本目录。原生实现边界：

- `NativeScoreEventStore`：SQLite append-only 本地事件日志、pending 查询和 ack。
- `NativeBroadcastSession`：AVFoundation / 选定视频 SDK 的 720p 推流与前后台生命周期。
- AVPlayer/Fabric 播放视图：短期授权 HLS、播放错误和延迟指标。
- Keychain：令牌存储；APNs：受控比赛通知；BackgroundTasks：录像补传。

在这些参数冻结前运行原生生成器会写入签名、包名和 Pod 配置，因此本轮刻意不执行。
