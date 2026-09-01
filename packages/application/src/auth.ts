import type { Id } from "@gamechanger/contracts";
import { DomainError } from "@gamechanger/domain";

export interface IdentityProvider {
  authenticate(token: string | undefined): Promise<Id>;
}

export class DevIdentityProvider implements IdentityProvider {
  async authenticate(token: string | undefined): Promise<Id> {
    if (!token?.startsWith("dev:")) throw new DomainError("UNAUTHENTICATED", "Use a dev:<account-uuid> token in memory mode.", 401);
    const accountId = token.slice(4);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      throw new DomainError("UNAUTHENTICATED", "The development account id is invalid.", 401);
    }
    return accountId as Id;
  }
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length);
}
