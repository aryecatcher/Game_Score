import type { BatterLine, GameSnapshot, Id, ScoreEvent, ScoreEventPayload, ScoreMutation } from "@gamechanger/contracts";

function emptySnapshot(gameId: Id): GameSnapshot {
  return {
    gameId,
    revision: 0,
    status: "SCHEDULED",
    inning: 1,
    half: "TOP",
    outs: 0,
    homeRuns: 0,
    awayRuns: 0,
    batterLines: [],
    updatedAt: new Date(0).toISOString()
  };
}

function updateBatterLine(lines: BatterLine[], payload: Extract<ScoreMutation, { type: "PLATE_APPEARANCE_RECORDED" }>): BatterLine[] {
  const next = lines.map((line) => ({ ...line }));
  let line = next.find((item) => item.athleteId === payload.batterAthleteId);
  if (!line) {
    line = { athleteId: payload.batterAthleteId, plateAppearances: 0, atBats: 0, hits: 0, walks: 0, strikeouts: 0, rbi: 0 };
    next.push(line);
  }
  line.plateAppearances += 1;
  if (!["WALK", "HIT_BY_PITCH", "SACRIFICE"].includes(payload.result)) line.atBats += 1;
  if (["SINGLE", "DOUBLE", "TRIPLE", "HOME_RUN"].includes(payload.result)) line.hits += 1;
  if (payload.result === "WALK") line.walks += 1;
  if (payload.result === "STRIKEOUT") line.strikeouts += 1;
  line.rbi += payload.rbi;
  return next.sort((a, b) => a.athleteId.localeCompare(b.athleteId));
}

function applyMutation(snapshot: GameSnapshot, payload: ScoreMutation): GameSnapshot {
  switch (payload.type) {
    case "GAME_STARTED":
      return { ...snapshot, status: "LIVE" };
    case "PLATE_APPEARANCE_RECORDED":
      return {
        ...snapshot,
        status: "LIVE",
        homeRuns: snapshot.homeRuns + (payload.offense === "HOME" ? payload.runs : 0),
        awayRuns: snapshot.awayRuns + (payload.offense === "AWAY" ? payload.runs : 0),
        outs: Math.min(3, snapshot.outs + payload.outs),
        batterLines: updateBatterLine(snapshot.batterLines, payload)
      };
    case "HALF_INNING_ADVANCED": {
      const topToBottom = snapshot.half === "TOP";
      return {
        ...snapshot,
        half: topToBottom ? "BOTTOM" : "TOP",
        inning: topToBottom ? snapshot.inning : snapshot.inning + 1,
        outs: 0
      };
    }
    case "GAME_FINALIZED":
      return { ...snapshot, status: "FINAL" };
  }
}

export function projectScore(gameId: Id, sourceEvents: readonly ScoreEvent[]): GameSnapshot {
  const events = [...sourceEvents].sort((a, b) => a.sequence - b.sequence);
  const corrections = new Map<Id, ScoreMutation | null>();
  for (const event of events) {
    if (event.payload.type === "CORRECTION_APPLIED") {
      corrections.set(event.payload.targetClientEventId, event.payload.replacement);
    }
  }

  let snapshot = emptySnapshot(gameId);
  for (const event of events) {
    let payload: ScoreEventPayload | null = event.payload;
    if (payload.type === "CORRECTION_APPLIED") {
      snapshot = { ...snapshot, revision: event.sequence, updatedAt: event.recordedAt };
      continue;
    }
    if (corrections.has(event.clientEventId)) payload = corrections.get(event.clientEventId) ?? null;
    if (payload !== null) snapshot = applyMutation(snapshot, payload);
    snapshot = { ...snapshot, revision: event.sequence, updatedAt: event.recordedAt };
  }
  return snapshot;
}

export function stableEventFingerprint(event: { payload: ScoreEventPayload; deviceId: Id; occurredAt: string }): string {
  return JSON.stringify({ deviceId: event.deviceId, occurredAt: event.occurredAt, payload: event.payload });
}
