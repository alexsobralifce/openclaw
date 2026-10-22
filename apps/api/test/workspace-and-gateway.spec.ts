import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  workspace: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  workspaceMember: { findFirst: vi.fn() },
  conversation: { findFirst: vi.fn() },
}));
vi.mock("@openclaw/database", () => ({ prisma: db }));

import { BadRequestException } from "@nestjs/common";
import { WorkspaceService } from "../src/modules/workspace/workspace.service";
import { InboxGateway } from "../src/modules/inbox/inbox.gateway";

beforeEach(() => vi.clearAllMocks());

describe("WorkspaceService", () => {
  it("getWorkspace não pede o usuário inteiro (sem passwordHash)", async () => {
    db.workspace.findUniqueOrThrow.mockResolvedValue({});
    await new WorkspaceService().getWorkspace("w1");
    const args = db.workspace.findUniqueOrThrow.mock.calls[0][0];
    const select = args.include.users.include.user.select;
    expect(select).toEqual({ id: true, name: true, email: true, avatarUrl: true });
    expect(select.passwordHash).toBeUndefined();
  });

  it("updateWorkspace grava só o nome, ignorando plan e slug do corpo", async () => {
    db.workspace.update.mockResolvedValue({});
    await new WorkspaceService().updateWorkspace("w1", { name: "  Nova Loja  ", plan: "ENTERPRISE", slug: "x" } as any);
    expect(db.workspace.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { name: "Nova Loja" } });
  });

  it("updateWorkspace limita o nome a 100 caracteres", async () => {
    db.workspace.update.mockResolvedValue({});
    await new WorkspaceService().updateWorkspace("w1", { name: "a".repeat(300) });
    expect(db.workspace.update.mock.calls[0][0].data.name).toHaveLength(100);
  });

  it.each([undefined, {}, { name: "   " }, { name: 5 }, { plan: "ENTERPRISE" }])(
    "updateWorkspace recusa corpo sem nome válido (%j)",
    (body) => {
      expect(() => new WorkspaceService().updateWorkspace("w1", body as any)).toThrow(BadRequestException);
      expect(db.workspace.update).not.toHaveBeenCalled();
    },
  );
});

describe("InboxGateway.handleConnection", () => {
  const client = (token?: string) =>
    ({ handshake: { auth: { token } }, data: {} as any, join: vi.fn(), disconnect: vi.fn() }) as any;
  const gateway = (verify: () => any = () => ({ sub: "u1" })) => new InboxGateway({ verify } as any);

  it("conta ACTIVE entra na sala do workspace", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
    db.workspaceMember.findFirst.mockResolvedValue({ workspaceId: "w1" });
    const c = client("jwt");
    await gateway().handleConnection(c);
    expect(c.join).toHaveBeenCalledWith("workspace:w1");
    expect(c.data.workspaceId).toBe("w1");
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "DISABLED"])("conta %s é desconectada mesmo com JWT válido", async (status) => {
    db.user.findUnique.mockResolvedValue({ status });
    const c = client("jwt");
    await gateway().handleConnection(c);
    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
    expect(db.workspaceMember.findFirst).not.toHaveBeenCalled();
  });

  it("usuário apagado é desconectado", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const c = client("jwt");
    await gateway().handleConnection(c);
    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
  });

  it("sem token ou com token inválido é desconectado", async () => {
    const semToken = client(undefined);
    await gateway().handleConnection(semToken);
    expect(semToken.disconnect).toHaveBeenCalledWith(true);

    const invalido = client("ruim");
    await gateway(() => {
      throw new Error("jwt malformed");
    }).handleConnection(invalido);
    expect(invalido.disconnect).toHaveBeenCalledWith(true);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
