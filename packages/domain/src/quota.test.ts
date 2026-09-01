import { describe, expect, it } from "vitest";
import type { Id } from "@gamechanger/contracts";
import { QuotaLedger } from "./quota.js";

const accountId = "00000000-0000-4000-8000-000000000005" as Id;

describe("quota ledger", () => {
  it("keeps reservation retries idempotent and prevents overspend", () => {
    const ledger = new QuotaLedger();
    ledger.grant({ id: "70000000-0000-4000-8000-000000000001" as Id, accountId, kind: "GRANT", units: 60, recordedAt: new Date().toISOString() });
    const reservation = { id: "70000000-0000-4000-8000-000000000002" as Id, accountId, kind: "RESERVE" as const, units: 40, reservationKey: "70000000-0000-4000-8000-000000000003" as Id, recordedAt: new Date().toISOString() };
    ledger.reserve(reservation);
    ledger.reserve(reservation);
    expect(ledger.balance(accountId)).toBe(20);
    expect(() => ledger.reserve({ ...reservation, id: "70000000-0000-4000-8000-000000000004" as Id, reservationKey: "70000000-0000-4000-8000-000000000005" as Id, units: 21 })).toThrow(/Insufficient/);
  });
});
