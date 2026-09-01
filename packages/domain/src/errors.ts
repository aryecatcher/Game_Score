import type { ReasonCode } from "@gamechanger/contracts";

export class DomainError extends Error {
  readonly code: ReasonCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ReasonCode, message: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}
