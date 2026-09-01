import type { Id } from "@gamechanger/contracts";
import { DomainError } from "./errors.js";

export type QuotaLedgerEntry = {
  id: Id;
  accountId: Id;
  kind: "GRANT" | "RESERVE" | "COMMIT" | "RELEASE";
  units: number;
  reservationKey?: Id;
  recordedAt: string;
};

export class QuotaLedger {
  readonly entries: QuotaLedgerEntry[] = [];

  balance(accountId: Id): number {
    return this.entries
      .filter((entry) => entry.accountId === accountId)
      .reduce((total, entry) => total + (entry.kind === "GRANT" || entry.kind === "RELEASE" ? entry.units : -entry.units), 0);
  }

  grant(entry: QuotaLedgerEntry): void {
    if (entry.kind !== "GRANT" || entry.units <= 0) throw new DomainError("VALIDATION_ERROR", "Grant must add positive units.");
    if (this.entries.some((candidate) => candidate.id === entry.id)) return;
    this.entries.push(entry);
  }

  reserve(entry: QuotaLedgerEntry): void {
    if (entry.kind !== "RESERVE" || !entry.reservationKey || entry.units <= 0) {
      throw new DomainError("VALIDATION_ERROR", "Reservation requires a key and positive units.");
    }
    const existing = this.entries.find((candidate) => candidate.reservationKey === entry.reservationKey && candidate.kind === "RESERVE");
    if (existing) {
      if (existing.units !== entry.units || existing.accountId !== entry.accountId) {
        throw new DomainError("DUPLICATE_REQUEST", "Reservation key was reused with different content.", 409);
      }
      return;
    }
    if (this.balance(entry.accountId) < entry.units) throw new DomainError("QUOTA_EXHAUSTED", "Insufficient quota.", 409);
    this.entries.push(entry);
  }

  release(entry: QuotaLedgerEntry): void {
    if (entry.kind !== "RELEASE" || !entry.reservationKey) throw new DomainError("VALIDATION_ERROR", "Release requires a reservation key.");
    const reservation = this.entries.find((candidate) => candidate.reservationKey === entry.reservationKey && candidate.kind === "RESERVE");
    if (!reservation) throw new DomainError("NOT_FOUND", "Reservation was not found.", 404);
    if (this.entries.some((candidate) => candidate.reservationKey === entry.reservationKey && candidate.kind === "RELEASE")) return;
    this.entries.push({ ...entry, units: reservation.units, accountId: reservation.accountId });
  }
}
