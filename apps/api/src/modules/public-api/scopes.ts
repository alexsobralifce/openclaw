import { SetMetadata } from "@nestjs/common";

export const SCOPES = [
  "contacts:read",
  "contacts:write",
  "conversations:read",
  "conversations:write",
  "messages:read",
  "messages:send",
  "email:read",
  "email:send",
  "calendar:read",
  "calendar:write",
  "webhooks:manage",
] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPES_KEY = "public-api:scopes";
/** Exige que a chave tenha todos os escopos listados. */
export const RequireScopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);

export interface ApiKeyContext {
  id: string;
  workspaceId: string;
  scopes: string[];
}
