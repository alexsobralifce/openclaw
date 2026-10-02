import { describe, expect, it } from "vitest";
import { ALL_SERVICES, canEditUser, canManageUsers, effectiveServices, serviceForScope } from "../src/modules/auth/permissions";
import { toolAllowed } from "../src/modules/channels/assistant/assistant.service";

describe("permissões", () => {
  it("root tem tudo; os demais só o que foi liberado (e só nomes válidos)", () => {
    expect(effectiveServices("ROOT", [])).toEqual(ALL_SERVICES);
    expect(effectiveServices("USER", ["inbox", "hackear"])).toEqual(["inbox"]);
    expect(effectiveServices("ADMIN", [])).toEqual([]);
  });

  it("gestão de usuários", () => {
    expect(canManageUsers("USER")).toBe(false);
    expect(canEditUser("ROOT", "ADMIN")).toBe(true);
    expect(canEditUser("ROOT", "USER", "ADMIN")).toBe(true);
    expect(canEditUser("ROOT", "ROOT")).toBe(false);
    expect(canEditUser("ROOT", "USER", "ROOT")).toBe(false);
    expect(canEditUser("ADMIN", "USER")).toBe(true);
    expect(canEditUser("ADMIN", "ADMIN")).toBe(false);
    expect(canEditUser("ADMIN", "USER", "ADMIN")).toBe(false);
    expect(canEditUser("USER", "USER")).toBe(false);
  });

  it("escopos da API exigem o serviço correspondente", () => {
    expect(serviceForScope("email:send")).toBe("email");
    expect(serviceForScope("messages:read")).toBe("inbox");
    expect(serviceForScope("webhooks:manage")).toBe("api");
  });

  it("assistente só oferece ferramentas dos serviços liberados", () => {
    expect(toolAllowed(["inbox"], "gmail_send")).toBe(false);
    expect(toolAllowed(["email"], "gmail_send")).toBe(true);
    expect(toolAllowed(["calendar"], "google_list_accounts")).toBe(true);
    expect(toolAllowed([], "remember")).toBe(true);
    expect(toolAllowed([], "reply_to_conversation")).toBe(false);
  });
});

describe("ferramentas de notas", () => {
  it("note_add e note_search dependem do serviço drive", () => {
    expect(toolAllowed(["drive"], "note_add")).toBe(true);
    expect(toolAllowed(["drive"], "note_search")).toBe(true);
    expect(toolAllowed(["inbox", "email"], "note_add")).toBe(false);
    expect(toolAllowed(["inbox", "email"], "note_search")).toBe(false);
  });
});
