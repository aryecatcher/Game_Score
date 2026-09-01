import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Id } from "@gamechanger/contracts";
import type { IdentityProvider, PlatformStore } from "@gamechanger/application";
import { DomainError } from "@gamechanger/domain";

export class OidcIdentityProvider implements IdentityProvider {
  private keyResolver: JWTVerifyGetKey | undefined;

  constructor(
    private readonly issuer: string,
    private readonly audience: string,
    private readonly store: PlatformStore
  ) {}

  private async keys(): Promise<JWTVerifyGetKey> {
    if (this.keyResolver) return this.keyResolver;
    const discoveryUrl = new URL(".well-known/openid-configuration", this.issuer.endsWith("/") ? this.issuer : `${this.issuer}/`);
    const response = await fetch(discoveryUrl);
    if (!response.ok) throw new DomainError("UNAUTHENTICATED", "OIDC discovery failed.", 401);
    const document = await response.json() as { jwks_uri?: string };
    if (!document.jwks_uri) throw new DomainError("UNAUTHENTICATED", "OIDC jwks_uri is missing.", 401);
    this.keyResolver = createRemoteJWKSet(new URL(document.jwks_uri));
    return this.keyResolver;
  }

  async authenticate(token: string | undefined): Promise<Id> {
    if (!token) throw new DomainError("UNAUTHENTICATED", "Bearer token is required.", 401);
    try {
      const { payload } = await jwtVerify(token, await this.keys(), { issuer: this.issuer, audience: this.audience });
      if (!payload.sub) throw new DomainError("UNAUTHENTICATED", "Token subject is missing.", 401);
      const account = await this.store.getAccountByExternalSubject(payload.sub);
      if (!account || account.status !== "ACTIVE") throw new DomainError("UNAUTHENTICATED", "Account is not active in this pilot.", 401);
      return account.id;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("UNAUTHENTICATED", "Token validation failed.", 401);
    }
  }
}
