import {
  ApiErrorSchema,
  AppendScoreBatchResponseSchema,
  BootstrapResponseSchema,
  GameEventsResponseSchema,
  GameSnapshotSchema,
  type AppendScoreBatchRequest,
  type BootstrapResponse,
  type GameEventsResponse,
  type GameSnapshot,
  type Id,
  type ReasonCode
} from "@gamechanger/contracts";
import { mobileConfig } from "../config.js";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ReasonCode,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export class ApiClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl = mobileConfig.apiBaseUrl
  ) {}

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        ...(init?.headers ?? {})
      }
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(body);
      if (parsed.success) {
        throw new ApiClientError(response.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.requestId);
      }
      throw new ApiClientError(response.status, "INTERNAL_ERROR", `HTTP ${response.status}`);
    }
    return body;
  }

  async bootstrap(): Promise<BootstrapResponse> {
    return BootstrapResponseSchema.parse(await this.request("/v1/bootstrap"));
  }

  async events(gameId: Id, afterSequence = 0): Promise<GameEventsResponse> {
    return GameEventsResponseSchema.parse(await this.request(`/v1/games/${gameId}/events?afterSequence=${afterSequence}`));
  }

  async snapshot(gameId: Id): Promise<GameSnapshot> {
    return GameSnapshotSchema.parse(await this.request(`/v1/games/${gameId}/snapshot`));
  }

  async appendScoreBatch(gameId: Id, request: AppendScoreBatchRequest) {
    return AppendScoreBatchResponseSchema.parse(await this.request(`/v1/games/${gameId}/score-events:batch`, {
      method: "POST",
      body: JSON.stringify(request)
    }));
  }
}
