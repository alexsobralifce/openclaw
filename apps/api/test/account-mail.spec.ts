import { beforeEach, describe, expect, it, vi } from "vitest";

const users: any[] = [];
vi.mock("@openclaw/database", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null,
      findFirst: async ({ where }: any) => users.find((u) => u.email?.toLowerCase() === where.email?.equals?.toLowerCase()) ?? null,
      findMany: async ({ where }: any) => users.filter((u) => u.role === where.role && u.status === where.status),
      count: async ({ where }: any = {}) => users.filter((u) => !where?.status || u.status === where.status).length,
      create: async ({ data }: any) => {
        const u = { id: `n${users.length}`, services: [], ...data, workspaces: [] };
        users.push(u);
        return u;
      },
      update: async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data),
    },
  },
}));

import { AuthService } from "../src/modules/auth/auth.service";
import { consumeToken, issueToken } from "../src/modules/auth/account-tokens";
import { mailHtml } from "../src/modules/auth/mail.service";

const store = new Map<string, any>();
const state = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => void store.set(k, v), del: async (k: string) => void store.delete(k) };
const sent: { to: any; subject: string; html: string }[] = [];
const mail = { send: async (to: any, subject: string, html: string) => (sent.push({ to, subject, html }), true) };
const make = () => new AuthService({ sign: () => "jwt" } as any, state as any, mail as any);
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  store.clear();
  users.splice(0);
  sent.length = 0;
});

describe("tokens de conta", () => {
  it("valem uma vez só e só o hash fica guardado", async () => {
    const t = await issueToken(state as any, "reset-password", "u1");
    expect([...store.keys()].some((k) => k.includes(t))).toBe(false);
    expect(await consumeToken(state as any, "verify-email", t)).toBeNull(); // tipo errado não serve
    expect(await consumeToken(state as any, "reset-password", t)).toBe("u1");
    expect(await consumeToken(state as any, "reset-password", t)).toBeNull();
  });
});

describe("e-mail do sistema", () => {
  it("escapa HTML do que vem do usuário", () => {
    expect(mailHtml("Oi", ["<script>alert(1)</script>"])).not.toContain("<script>");
  });
});

describe("cadastro por e-mail e senha", () => {
  it("confirma o e-mail ao usuário e avisa o root com o plano; a conta entra ativa, mas sem plano", async () => {
    users.push({ id: "r", role: "ROOT", status: "ACTIVE", email: "root@x.com", name: "Root" });
    const res: any = await make().register("ana@x.com", "Ana Lima", "senha-forte-1", "Espaço da Ana");
    await tick();
    expect(res.pending).toBeUndefined();
    expect(res.accessToken).toBeTruthy();
    const toUser = sent.find((m) => m.to === "ana@x.com")!;
    expect(toUser.html).toContain("/auth/confirmar?token=");
    const toRoot = sent.find((m) => Array.isArray(m.to) && m.to.includes("root@x.com"))!;
    expect(toRoot.html).toContain("Ana Lima");
    expect(toRoot.html).toContain("nenhum plano escolhido ainda");
    // o link só confirma o e-mail; o acesso continua dependendo de plano
    const token = /token=([\w-]+)/.exec(toUser.html)![1];
    await make().verifyEmail(token);
    const ana = users.find((u) => u.email === "ana@x.com");
    expect(ana.emailVerifiedAt).toBeInstanceOf(Date);
    expect(ana).toMatchObject({ status: "ACTIVE", planRequired: true });
  });

  it("cadastro novo abre o tour de boas-vindas até ele ser concluído", async () => {
    users.push({ id: "r", role: "ROOT", status: "ACTIVE", email: "root@x.com", name: "Root" });
    const res: any = await make().register("leo@x.com", "Leo Dias", "senha-forte-1", "Espaço do Leo");
    expect(res.user.onboarding).toBe(true);
    const leo = users.find((u) => u.email === "leo@x.com");
    await make().finishOnboarding(leo.id);
    expect(leo.onboardedAt).toBeInstanceOf(Date);
    expect((make() as any).view(leo).onboarding).toBe(false);
    // conta antiga (sem planRequired) nunca abre o tour sozinha
    expect((make() as any).view({ ...leo, planRequired: false, onboardedAt: null }).onboarding).toBe(false);
  });

  it("cadastro pelo Google já vem com e-mail confirmado e também avisa o root", async () => {
    users.push({ id: "r", role: "ROOT", status: "ACTIVE", email: "root@x.com", name: "Root" });
    await make().registerFromGoogle("bia@gmail.com", "Bia Souza");
    await tick();
    expect(users.find((u) => u.email === "bia@gmail.com").emailVerifiedAt).toBeInstanceOf(Date);
    expect(sent.some((m) => m.to === "bia@gmail.com")).toBe(false);
    expect(sent.some((m) => Array.isArray(m.to) && m.html.includes("Google"))).toBe(true);
  });
});

describe("recuperação de senha", () => {
  it("responde igual para e-mail desconhecido, e só envia para conta com senha", async () => {
    users.push({ id: "u1", email: "a@x.com", name: "A", passwordHash: "h", status: "ACTIVE", role: "USER" }, { id: "u2", email: "g@x.com", name: "G", passwordHash: null, status: "ACTIVE", role: "USER" });
    const auth = make();
    expect(await auth.requestPasswordReset("nao@existe.com")).toEqual({ ok: true });
    expect(await auth.requestPasswordReset("g@x.com")).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    await auth.requestPasswordReset("a@x.com");
    expect(sent).toHaveLength(1);
  });

  it("troca a senha com o link (uso único) e recusa link inválido", async () => {
    users.push({ id: "u1", email: "a@x.com", name: "A", passwordHash: "antigo", status: "ACTIVE", role: "USER" });
    const auth = make();
    await auth.requestPasswordReset("a@x.com");
    const token = /token=([\w-]+)/.exec(sent[0].html)![1];
    await auth.resetPassword(token, "nova-senha-123");
    expect(users[0].passwordHash).not.toBe("antigo");
    await expect(auth.resetPassword(token, "outra-senha-123")).rejects.toThrow("inválido");
    await expect(auth.resetPassword("lixo", "outra-senha-123")).rejects.toThrow();
  });
});
