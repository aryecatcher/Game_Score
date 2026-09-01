import React, { useEffect, useMemo, useState } from "react";
import { Button, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import type { GameSnapshot, Id, ScoreEventPayload } from "@gamechanger/contracts";
import { ApiClient } from "./api/client.js";
import { GameFeed } from "./realtime/game-feed.js";
import { LiveScoreFollower, type LiveScoreStatus } from "./realtime/live-score-follower.js";
import { HybridScoreEventLog } from "./scoring/event-log.js";
import { ScoreSyncEngine } from "./scoring/sync-engine.js";

const ids = {
  scorer: "00000000-0000-4000-8000-000000000002" as Id,
  fan: "00000000-0000-4000-8000-000000000005" as Id,
  game: "20000000-0000-4000-8000-000000000001" as Id,
  batter: "30000000-0000-4000-8000-000000000001" as Id,
  device: "40000000-0000-4000-8000-000000000001" as Id
};

type Mode = "SCORER" | "VIEWER";

function statusText(status: LiveScoreStatus): string {
  switch (status.type) {
    case "CONNECTING": return "正在读取官方事件并连接实时服务";
    case "LIVE": return `实时已连接 · 官方序号 ${status.latestSequence}`;
    case "RECOVERING": return `检测到序号缺口，正在回源恢复到 ${status.requestedSequence}`;
    case "ERROR": return `实时连接失败 · ${status.code}`;
  }
}

function LiveScorePanel(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GameSnapshot | undefined>();
  const [connection, setConnection] = useState("准备连接");
  const [teams, setTeams] = useState({ home: "主队", away: "客队" });

  useEffect(() => {
    const token = `dev:${ids.fan}`;
    const api = new ApiClient(token);
    const feed = new GameFeed();
    const follower = new LiveScoreFollower(api, feed, token, ids.game, {
      onSnapshot: setSnapshot,
      onStatus: (status) => setConnection(statusText(status))
    });
    void api.bootstrap()
      .then((bootstrap) => setTeams({ home: bootstrap.pilot.game.homeTeamName, away: bootstrap.pilot.game.awayTeamName }))
      .catch(() => setConnection("无法读取试点比赛信息"));
    void follower.start().catch((error: unknown) => {
      setConnection(`初始化失败 · ${error instanceof Error ? error.message : "unknown"}`);
    });
    return () => follower.stop();
  }, []);

  return (
    <View style={styles.section}>
      <View style={styles.scoreboard}>
        <View style={styles.teamColumn}>
          <Text style={styles.teamLabel}>{teams.away}</Text>
          <Text style={styles.teamScore}>{snapshot?.awayRuns ?? 0}</Text>
        </View>
        <View style={styles.gameState}>
          <Text style={styles.gameStatePrimary}>
            {snapshot ? `${snapshot.inning} 局 ${snapshot.half === "TOP" ? "上" : "下"}` : "等待比赛"}
          </Text>
          <Text style={styles.gameStateSecondary}>出局 {snapshot?.outs ?? 0}</Text>
          <Text style={styles.gameStateSecondary}>{snapshot?.status ?? "SCHEDULED"}</Text>
        </View>
        <View style={styles.teamColumn}>
          <Text style={styles.teamLabel}>{teams.home}</Text>
          <Text style={styles.teamScore}>{snapshot?.homeRuns ?? 0}</Text>
        </View>
      </View>
      <View style={styles.connectionCard}>
        <Text style={styles.connectionLabel}>实时状态</Text>
        <Text style={styles.connectionText}>{connection}</Text>
      </View>
      <Text style={styles.note}>实时消息只负责低延迟通知；发生序号缺口时自动从官方 events API 重建，不把 WebSocket 当作事实源。</Text>
    </View>
  );
}

export default function App(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("SCORER");
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("尚未同步");
  const [localOrder, setLocalOrder] = useState(0);
  const services = useMemo(() => {
    const log = new HybridScoreEventLog();
    const api = new ApiClient(`dev:${ids.scorer}`);
    return { log, sync: new ScoreSyncEngine(api, log) };
  }, []);

  const append = async (payload: ScoreEventPayload): Promise<void> => {
    const nextOrder = localOrder + 1;
    setLocalOrder(nextOrder);
    await services.log.append({
      gameId: ids.game,
      authorityEpoch: 1,
      localOrder: nextOrder,
      clientEventId: crypto.randomUUID() as Id,
      deviceId: ids.device,
      occurredAt: new Date().toISOString(),
      payload
    });
    setMessage(`本地已写入事件 #${nextOrder}`);
  };

  const sync = async (): Promise<void> => {
    try {
      const nextRevision = await services.sync.sync(ids.game, revision, 1);
      setRevision(nextRevision);
      setMessage(`已同步到服务端 revision ${nextRevision}`);
    } catch (error) {
      setMessage(`同步失败，事件仍保留在本地：${error instanceof Error ? error.message : "unknown"}`);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.kicker}>棒球 · iOS 小范围试点</Text>
        <Text style={styles.title}>{mode === "SCORER" ? "官方记分台" : "实时比分"}</Text>
        <Text style={styles.body}>同一个 React Native App，根据球队授权进入不同角色功能。</Text>
        <View style={styles.modeActions}>
          <Button title="官方记分员" onPress={() => setMode("SCORER")} disabled={mode === "SCORER"} />
          <Button title="获批球迷" onPress={() => setMode("VIEWER")} disabled={mode === "VIEWER"} />
        </View>

        {mode === "VIEWER" ? <LiveScorePanel /> : (
          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.label}>服务端 revision</Text>
              <Text style={styles.score}>{revision}</Text>
              <Text style={styles.status}>{message}</Text>
            </View>
            <View style={styles.actions}>
              <Button title="开始比赛" onPress={() => void append({ type: "GAME_STARTED" })} />
              <Button title="记录本垒打" onPress={() => void append({ type: "PLATE_APPEARANCE_RECORDED", offense: "HOME", batterAthleteId: ids.batter, result: "HOME_RUN", runs: 1, outs: 0, rbi: 1 })} />
              <Button title="半局结束" onPress={() => void append({ type: "HALF_INNING_ADVANCED" })} />
              <Button title="立即同步" onPress={() => void sync()} />
            </View>
            <Text style={styles.note}>当前记分界面使用合成数据。实际 iOS SQLite、相机推流、AVPlayer 和 APNs 仍需通过 Turbo Native Module 接入。</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#071A13" },
  container: { padding: 24, gap: 16 },
  kicker: { color: "#74D99F", fontSize: 14, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#FFFFFF", fontSize: 34, fontWeight: "800" },
  body: { color: "#B5C8BE", fontSize: 16, lineHeight: 24 },
  modeActions: { flexDirection: "row", gap: 12 },
  section: { gap: 16 },
  card: { backgroundColor: "#102A20", borderRadius: 18, padding: 20, gap: 8 },
  label: { color: "#89A999", fontSize: 13 },
  score: { color: "#FFFFFF", fontSize: 48, fontWeight: "800" },
  status: { color: "#D8E8DF", fontSize: 14 },
  actions: { gap: 12 },
  scoreboard: { flexDirection: "row", backgroundColor: "#102A20", borderRadius: 18, padding: 18, alignItems: "center" },
  teamColumn: { flex: 1, alignItems: "center", gap: 8 },
  teamLabel: { color: "#B5C8BE", fontSize: 12, textAlign: "center" },
  teamScore: { color: "#FFFFFF", fontSize: 44, fontWeight: "800" },
  gameState: { width: 92, alignItems: "center", gap: 4 },
  gameStatePrimary: { color: "#74D99F", fontSize: 14, fontWeight: "700" },
  gameStateSecondary: { color: "#89A999", fontSize: 11 },
  connectionCard: { borderColor: "#28533E", borderWidth: 1, borderRadius: 14, padding: 16, gap: 5 },
  connectionLabel: { color: "#74D99F", fontSize: 12, fontWeight: "700" },
  connectionText: { color: "#D8E8DF", fontSize: 14, lineHeight: 20 },
  note: { color: "#89A999", fontSize: 13, lineHeight: 19, marginTop: 4 }
});
