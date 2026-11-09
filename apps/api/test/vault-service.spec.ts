import { beforeEach, describe, expect, it, vi } from "vitest";

const { vaults, blocks, db } = vi.hoisted(() => {
  const vaults: any[] = [];
  const blocks: any[] = [];
  const match = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => (v && typeof v === "object" && "lt" in v ? row[k] < v.lt : row[k] === v));
  const db: any = {
    vault: {
      findFirst: async ({ where }: any) => vaults.find((r) => match(r, where)) ?? null,
      count: async ({ where }: any) => vaults.filter((r) => match(r, where)).length,
      create: async ({ data }: any) => void vaults.push({ createdAt: new Date(), ...data, seq: 0, headHash: "" }),
      delete: async ({ where }: any) => void vaults.splice(vaults.findIndex((r) => r.id === where.id), 1),
      update: async ({ where, data }: any) => void Object.assign(vaults.find((r) => r.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const rows = vaults.filter((r) => match(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    vaultBlock: {
      findMany: async ({ where }: any) => blocks.filter((r) => match(r, where)).sort((a, b) => a.seq - b.seq),
      create: async ({ data }: any) => void blocks.push({ id: `b${blocks.length}-${Math.random()}`, createdAt: new Date(), ...data }),
      update: async ({ where, data }: any) => void Object.assign(blocks.find((r) => r.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const rows = blocks.filter((r) => match(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    $transaction: async (cb: any) => cb(db),
    user: { findUnique: async () => ({ email: "ana.souza@gmail.com" }) },
  };
  db.vault.deleteMany = async ({ where }: any) => {
    const gone = vaults.filter((r) => match(r, where));
    gone.forEach((r) => vaults.splice(vaults.indexOf(r), 1));
    return { count: gone.length };
  };
  db.vaultBlock.deleteMany = async ({ where }: any) => {
    const gone = blocks.filter((r) => match(r, where));
    gone.forEach((r) => blocks.splice(blocks.indexOf(r), 1));
    return { count: gone.length };
  };
  return { vaults, blocks, db };
});
vi.mock("@magobox/database", () => ({ prisma: db }));

import { matchEntries, VaultService } from "../src/modules/vault/vault.service";

const kv = new Map<string, any>();
const state = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: any) => void kv.set(k, v),
  del: async (k: string) => void kv.delete(k),
  incr: async (k: string) => {
    const n = (kv.get(k) ?? 0) + 1;
    kv.set(k, n);
    return n;
  },
};

const PW = "Correta-Horse-9!";
const gh = { title: "GitHub", url: "https://github.com", username: "ana@x.com", password: "S3nh@-do-GitHub!", notes: "2FA no app", whatsapp: true };

const sent: { to: string; subject: string; text: string }[] = [];
const google = {
  accounts: ["ana.souza@gmail.com"] as string[],
  fail: false,
  listAccounts: async () => google.accounts,
  gmailSend: async (_ws: string, to: string, subject: string, text: string) => {
    if (google.fail) throw new Error("Google API 500");
    sent.push({ to, subject, text });
  },
};

let svc: VaultService;
beforeEach(() => {
  sent.length = 0;
  google.accounts = ["ana.souza@gmail.com"];
  google.fail = false;
  vaults.length = 0;
  blocks.length = 0;
  kv.clear();
  svc = new VaultService(state as any, google as any);
});

async function ready() {
  await svc.setup("u1", "w1", PW);
  await svc.unlock("u1", PW, 15);
}

describe("criar e desbloquear", () => {
  it("cria o cofre sem gravar a senha mestra nem a chave em claro", async () => {
    await svc.setup("u1", "w1", PW);
    const dump = JSON.stringify(vaults);
    expect(dump).not.toContain(PW);
    expect(vaults[0].wrappedKey).toMatch(/^v1\./);
    expect(await svc.status("u1")).toEqual({ exists: true, unlocked: false, hasRecovery: true, hasPin: false, waLocked: false });
  });

  it("recusa senha fraca e segundo cofre", async () => {
    await expect(svc.setup("u1", "w1", "fraca")).rejects.toThrow("12 caracteres");
    await svc.setup("u1", "w1", PW);
    await expect(svc.setup("u1", "w1", PW)).rejects.toThrow("já tem");
  });

  it("senha errada não abre; 5 erros seguidos bloqueiam até a certa", async () => {
    await svc.setup("u1", "w1", PW);
    for (let i = 0; i < 5; i++) await expect(svc.unlock("u1", "Errada-Horse-9!!")).rejects.toThrow("incorreta");
    await expect(svc.unlock("u1", PW)).rejects.toThrow("Muitas tentativas");
    expect((await svc.status("u1")).unlocked).toBe(false);
  });

  it("uma senha certa zera a contagem de erros", async () => {
    await svc.setup("u1", "w1", PW);
    for (let i = 0; i < 3; i++) await expect(svc.unlock("u1", "Errada-Horse-9!!")).rejects.toThrow();
    await svc.unlock("u1", PW);
    svc.lock("u1");
    for (let i = 0; i < 3; i++) await expect(svc.unlock("u1", "Errada-Horse-9!!")).rejects.toThrow("incorreta");
  });

  it("bloqueado, nada funciona (código VAULT_LOCKED)", async () => {
    await svc.setup("u1", "w1", PW);
    await expect(svc.list("u1")).rejects.toMatchObject({ response: { code: "VAULT_LOCKED" } });
    await expect(svc.save("u1", undefined, gh)).rejects.toMatchObject({ response: { code: "VAULT_LOCKED" } });
  });

  it("o desbloqueio expira e o bloqueio manual apaga a sessão", async () => {
    vi.useFakeTimers();
    try {
      await svc.setup("u1", "w1", PW);
      await svc.unlock("u1", PW, 1);
      expect((await svc.status("u1")).unlocked).toBe(true);
      vi.advanceTimersByTime(61_000);
      expect((await svc.status("u1")).unlocked).toBe(false);
      await svc.unlock("u1", PW, 5);
      svc.lock("u1");
      expect((await svc.status("u1")).unlocked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("entradas", () => {
  it("guarda cifrado: nada legível no banco", async () => {
    await ready();
    await svc.save("u1", undefined, gh);
    const dump = JSON.stringify([vaults, blocks]);
    for (const secret of [gh.password, gh.username, gh.title, gh.notes, "github.com"]) expect(dump).not.toContain(secret);
  });

  it("lista sem senha; revelar devolve tudo", async () => {
    await ready();
    const { id } = await svc.save("u1", undefined, gh);
    const list = await svc.list("u1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, title: "GitHub", username: "ana@x.com", hasPassword: true });
    expect(JSON.stringify(list)).not.toContain(gh.password);
    expect(await svc.reveal("u1", id)).toEqual(gh);
  });

  it("atualizar troca o conteúdo e descarta o antigo; a cadeia continua válida", async () => {
    await ready();
    const { id } = await svc.save("u1", undefined, gh);
    await svc.save("u1", id, { ...gh, password: "NovaSenha#2026-xyz" });
    expect((await svc.reveal("u1", id)).password).toBe("NovaSenha#2026-xyz");
    expect(blocks.filter((b) => b.entryId === id && b.payload)).toHaveLength(1); // só o mais recente guarda conteúdo
    expect(await svc.verify("u1")).toMatchObject({ ok: true, blocks: 2 });
  });

  it("excluir remove da lista, apaga todo o conteúdo e mantém a cadeia", async () => {
    await ready();
    const { id } = await svc.save("u1", undefined, gh);
    await svc.save("u1", undefined, { ...gh, title: "Outro" });
    await svc.remove("u1", id);
    expect((await svc.list("u1")).map((e) => e.title)).toEqual(["Outro"]);
    expect(blocks.filter((b) => b.entryId === id).every((b) => b.payload === "")).toBe(true);
    await expect(svc.reveal("u1", id)).rejects.toThrow("não encontrada");
    expect(await svc.verify("u1")).toMatchObject({ ok: true, blocks: 3 });
  });

  it("valida os dados e não deixa mexer em entrada que não existe", async () => {
    await ready();
    await expect(svc.save("u1", undefined, { password: "x" })).rejects.toThrow("nome");
    await expect(svc.save("u1", "nao-existe", gh)).rejects.toThrow("não encontrada");
    await expect(svc.remove("u1", "nao-existe")).rejects.toThrow("não encontrada");
  });

  it("cada usuário só vê o próprio cofre", async () => {
    await ready();
    await svc.save("u1", undefined, gh);
    await svc.setup("u2", "w1", "Outra-Frase-Forte-7!");
    await svc.unlock("u2", "Outra-Frase-Forte-7!");
    expect(await svc.list("u2")).toEqual([]);
  });
});

describe("adulteração no banco é detectada", () => {
  async function withEntries() {
    await ready();
    const a = await svc.save("u1", undefined, gh);
    await svc.save("u1", undefined, { ...gh, title: "Netflix", username: "ana@n.com" });
    await svc.save("u1", undefined, { ...gh, title: "Banco", username: "ana@b.com" });
    return a.id;
  }

  it("cofre íntegro passa", async () => {
    await withEntries();
    expect(await svc.verify("u1")).toEqual({ ok: true, blocks: 3, problem: undefined, unreadable: 0 });
  });

  it("conteúdo cifrado trocado entre entradas", async () => {
    await withEntries();
    [blocks[0].payload, blocks[1].payload] = [blocks[1].payload, blocks[0].payload];
    const r = await svc.verify("u1");
    expect(r.ok).toBe(false);
    expect(r.unreadable).toBe(2);
    expect((await svc.list("u1")).filter((e) => e.corrupted)).toHaveLength(2);
  });

  it("bloco removido do meio, do fim ou cabeça do cofre adulterada", async () => {
    await withEntries();
    const saved = JSON.parse(JSON.stringify(blocks));
    blocks.splice(1, 1);
    expect(await svc.verify("u1")).toMatchObject({ ok: false, problem: expect.stringContaining("Faltando o bloco 2") });

    blocks.length = 0;
    blocks.push(...JSON.parse(JSON.stringify(saved)).map((b: any) => ({ ...b, createdAt: new Date() })));
    blocks.pop();
    expect(await svc.verify("u1")).toMatchObject({ ok: false, problem: expect.stringContaining("removidos") });

    blocks.push(...JSON.parse(JSON.stringify(saved)).slice(2).map((b: any) => ({ ...b, createdAt: new Date() })));
    vaults[0].headHash = "f".repeat(64);
    expect((await svc.verify("u1")).ok).toBe(false);
  });

  it("refazer a cadeia sem a chave do cofre não engana a verificação", async () => {
    await withEntries();
    // Atacante com acesso ao banco altera um bloco e recalcula os hashes com SHA-256 puro
    const { createHash } = await import("crypto");
    let prev = "0".repeat(64);
    for (const b of blocks) {
      b.prevHash = prev;
      b.hash = createHash("sha256").update([vaults[0].id, b.seq, b.prevHash, b.op, b.entryId, b.payloadHash].join("|")).digest("hex");
      prev = b.hash;
    }
    vaults[0].headHash = prev;
    expect((await svc.verify("u1")).ok).toBe(false);
  });
});

describe("senha mestra", () => {
  it("trocar mantém as entradas e exige a senha antiga e a nova forte", async () => {
    await ready();
    const { id } = await svc.save("u1", undefined, gh);
    await expect(svc.changeMaster("u1", "Errada-Horse-9!!", "Nova-Frase-Forte-3!")).rejects.toThrow("incorreta");
    await expect(svc.changeMaster("u1", PW, "fraca")).rejects.toThrow("12 caracteres");
    await svc.changeMaster("u1", PW, "Nova-Frase-Forte-3!");
    expect((await svc.status("u1")).unlocked).toBe(false); // sessão encerrada
    await expect(svc.unlock("u1", PW)).rejects.toThrow("incorreta");
    await svc.unlock("u1", "Nova-Frase-Forte-3!");
    expect((await svc.reveal("u1", id)).password).toBe(gh.password);
    expect((await svc.verify("u1")).ok).toBe(true);
  });
});

const PIN = "4827";

describe("consulta pelo WhatsApp com código de 4 dígitos", () => {
  async function withPin() {
    await ready();
    const a = await svc.save("u1", undefined, gh);
    await svc.save("u1", undefined, { ...gh, title: "Instagram", url: "https://instagram.com", username: "ana_insta", password: "Insta#Pass-99" });
    await svc.save("u1", undefined, { ...gh, title: "Banco", username: "12345", password: "Banco#Segredo-77", whatsapp: false });
    await svc.setPin("u1", PW, PIN);
    svc.lock("u1"); // o painel pode estar trancado: o WhatsApp não depende dele
    return a.id;
  }

  it("define o código só com a senha mestra e recusa códigos fracos", async () => {
    await ready();
    await expect(svc.setPin("u1", "Errada-Horse-9!!", PIN)).rejects.toThrow("incorreta");
    for (const bad of ["123", "12345", "abcd", "1111", "1234", "4321", "1212"]) await expect(svc.setPin("u1", PW, bad)).rejects.toThrow();
    await svc.setPin("u1", PW, PIN);
    expect((await svc.status("u1")).hasPin).toBe(true);
  });

  it("responde o estado certo antes do código", async () => {
    expect((await svc.whatsappLookup("u1", "github")).state).toBe("none");
    await svc.setup("u1", "w1", PW);
    expect((await svc.whatsappLookup("u1", "github")).state).toBe("no_pin");
    await svc.unlock("u1", PW);
    await svc.setPin("u1", PW, PIN);
    expect((await svc.whatsappLookup("u1", "github")).state).toBe("pin_required");
    expect(await svc.whatsappReveal("u1", "qualquer")).toBe("pin_required");
  });

  it("com o cofre trancado no painel, o código certo abre; lista sem senhas; revelar gasta o código", async () => {
    const id = await withPin();
    expect((await svc.status("u1")).unlocked).toBe(false);
    expect(await svc.whatsappOpen("u1", PIN)).toEqual({ ok: true });
    const r = await svc.whatsappLookup("u1", "instagrám");
    expect(r.state).toBe("ok");
    expect(r.matches.map((m) => m.title)).toEqual(["Instagram"]);
    expect(JSON.stringify(r)).not.toContain("Insta#Pass");

    const gh1 = await svc.whatsappReveal("u1", id);
    expect(gh1).toMatchObject({ title: "GitHub", password: gh.password });
    expect(JSON.stringify(gh1)).not.toContain("2FA"); // notas nunca vão para o WhatsApp
    expect(await svc.whatsappReveal("u1", id)).toBe("pin_required"); // gasto: pede o código de novo
    expect((await svc.whatsappLookup("u1", "github")).state).toBe("pin_required");
  });

  it("entradas não marcadas para o WhatsApp só existem no painel", async () => {
    await withPin();
    await svc.whatsappOpen("u1", PIN);
    expect((await svc.whatsappLookup("u1", "banco")).matches).toEqual([]);
    expect(blocks.filter((b) => b.waPayload).length).toBe(2);
  });

  it("entradas salvas depois do código também ganham cópia; editar desmarcando remove", async () => {
    await withPin();
    await svc.unlock("u1", PW);
    const { id } = await svc.save("u1", undefined, { ...gh, title: "Spotify", password: "Spot#Pass-55" });
    await svc.whatsappOpen("u1", PIN);
    expect((await svc.whatsappLookup("u1", "spotify")).matches).toHaveLength(1);
    await svc.save("u1", id, { ...gh, title: "Spotify", password: "Spot#Pass-55", whatsapp: false });
    await svc.whatsappOpen("u1", PIN);
    expect((await svc.whatsappLookup("u1", "spotify")).matches).toEqual([]);
  });

  it("lista os nomes das entradas do WhatsApp sem pedir o código, e nunca as senhas", async () => {
    await withPin();
    const r = await svc.whatsappList("u1");
    expect(r).toEqual({ state: "ok", items: [expect.objectContaining({ title: "GitHub" }), expect.objectContaining({ title: "Instagram" })], unindexed: 0 });
    expect(JSON.stringify(r)).not.toMatch(/S3nh@|Insta#Pass|ana_insta|Banco/);
    expect((await svc.status("u1")).unlocked).toBe(false); // nada foi aberto
  });

  it("a lista respeita o estado: sem cofre, sem código e bloqueado", async () => {
    expect((await svc.whatsappList("u1")).state).toBe("none");
    await svc.setup("u1", "w1", PW);
    expect((await svc.whatsappList("u1")).state).toBe("no_pin");
    await svc.unlock("u1", PW);
    await svc.setPin("u1", PW, PIN);
    for (let i = 0; i < 3; i++) await svc.whatsappOpen("u1", "9081");
    expect((await svc.whatsappList("u1")).state).toBe("locked");
  });

  it("entradas antigas, sem título no índice, entram na lista depois do primeiro código", async () => {
    await withPin();
    blocks.forEach((b) => (b.waLabel = ""));
    expect(await svc.whatsappList("u1")).toMatchObject({ items: [], unindexed: 2 });
    await svc.whatsappOpen("u1", PIN);
    expect((await svc.whatsappList("u1")).items.map((i) => i.title)).toEqual(["GitHub", "Instagram"]);
  });

  it("editar ou desmarcar tira o título antigo da lista; título alterado no banco é ignorado", async () => {
    const id = await withPin();
    await svc.unlock("u1", PW);
    await svc.save("u1", id, { ...gh, whatsapp: false });
    expect((await svc.whatsappList("u1")).items.map((i) => i.title)).toEqual(["Instagram"]);
    blocks.filter((b) => b.waLabel).forEach((b) => (b.waLabel = "v1.AAAA.AAAA.AAAA")); // título adulterado
    expect(await svc.whatsappList("u1")).toMatchObject({ items: [], unindexed: 1 });
  });

  it("nada legível no banco, nem nas cópias do WhatsApp", async () => {
    await withPin();
    const dump = JSON.stringify([vaults, blocks]);
    for (const secret of [gh.password, "Insta#Pass", "ana_insta", PIN, "Instagram", "GitHub"]) expect(dump).not.toContain(secret);
  });

  it("código errado: conta, avisa quantas restam e no 3º bloqueia o WhatsApp", async () => {
    await withPin();
    expect(await svc.whatsappOpen("u1", "1357")).toEqual({ ok: false, reason: "wrong", left: 2 });
    expect(await svc.whatsappOpen("u1", "2468")).toEqual({ ok: false, reason: "wrong", left: 1 });
    expect(await svc.whatsappOpen("u1", "9753")).toEqual({ ok: false, reason: "locked" });
    // bloqueado: nem o código certo funciona
    expect(await svc.whatsappOpen("u1", PIN)).toEqual({ ok: false, reason: "locked" });
    expect((await svc.whatsappLookup("u1", "github")).state).toBe("locked");
    expect((await svc.status("u1")).waLocked).toBe(true);
  });

  it("a senha mestra no painel reativa o WhatsApp", async () => {
    await withPin();
    for (const p of ["1357", "2468", "9753"]) await svc.whatsappOpen("u1", p);
    await svc.unlock("u1", PW);
    expect((await svc.status("u1")).waLocked).toBe(false);
    expect(await svc.whatsappOpen("u1", PIN)).toEqual({ ok: true });
  });

  it("um acerto zera a contagem de erros", async () => {
    await withPin();
    await svc.whatsappOpen("u1", "1357");
    await svc.whatsappOpen("u1", "2468");
    expect(await svc.whatsappOpen("u1", PIN)).toEqual({ ok: true });
    expect(await svc.whatsappOpen("u1", "1357")).toEqual({ ok: false, reason: "wrong", left: 2 });
  });

  it("tentativas simultâneas não furam o limite", async () => {
    await withPin();
    const guesses = ["1357", "2468", "9753", "1590", "6420", "7913", PIN];
    const results = await Promise.all(guesses.map((g) => svc.whatsappOpen("u1", g)));
    expect(results.filter((r) => r.ok)).toHaveLength(0); // o código certo, na 7ª tentativa, já não passa
    expect((await svc.status("u1")).waLocked).toBe(true);
  });

  it("sem o segredo do servidor, o código não abre nada (quem só tem o banco não testa os 10 mil códigos)", async () => {
    await withPin();
    const prev = process.env.VAULT_PEPPER;
    process.env.VAULT_PEPPER = "outro-segredo";
    try {
      expect(await svc.whatsappOpen("u1", PIN)).toMatchObject({ ok: false, reason: "wrong" });
    } finally {
      if (prev === undefined) delete process.env.VAULT_PEPPER;
      else process.env.VAULT_PEPPER = prev;
    }
  });

  it("trocar o código gera chave nova: o código antigo deixa de valer", async () => {
    await withPin();
    await svc.setPin("u1", PW, "7391");
    expect((await svc.whatsappOpen("u1", PIN)).ok).toBe(false);
    expect(await svc.whatsappOpen("u1", "7391")).toEqual({ ok: true });
    expect((await svc.whatsappLookup("u1", "github")).matches).toHaveLength(1);
  });

  it("formato inválido não gasta tentativa", async () => {
    await withPin();
    expect(await svc.whatsappOpen("u1", "12")).toMatchObject({ ok: false, reason: "wrong" });
    expect(await svc.whatsappOpen("u1", "abcd")).toMatchObject({ ok: false, reason: "wrong" });
    expect(await svc.whatsappOpen("u1", "1357")).toEqual({ ok: false, reason: "wrong", left: 2 });
  });

  it("redefinir a senha mestra com a chave de recuperação mantém o código e as cópias do WhatsApp", async () => {
    const { recoveryKey } = await svc.setup("u1", "w1", PW);
    await svc.unlock("u1", PW);
    await svc.save("u1", undefined, gh);
    await svc.setPin("u1", PW, PIN);
    await svc.requestReset("u1");
    await svc.recoverWithKey("u1", linkToken(), recoveryKey, "Nova-Frase-Forte-3!");
    expect(await svc.whatsappOpen("u1", PIN)).toEqual({ ok: true });
    expect((await svc.whatsappLookup("u1", "github")).matches).toHaveLength(1);
  });

  it("recomeçar com cofre vazio apaga também o código: é preciso definir outro", async () => {
    await svc.setup("u1", "w1", PW);
    await svc.unlock("u1", PW);
    await svc.setPin("u1", PW, PIN);
    await svc.requestReset("u1");
    await svc.resetEmpty("u1", linkToken(), "APAGAR", "Nova-Frase-Forte-3!");
    expect((await svc.whatsappLookup("u1", "github")).state).toBe("no_pin");
  });
});

describe("busca", () => {
  const list = [
    { title: "GitHub", url: "https://github.com", username: "ana@x.com" },
    { title: "Banco do Brasil", url: "https://bb.com.br", username: "12345" },
    { title: "Netflix", url: "https://netflix.com", username: "ana@x.com" },
  ];
  it("título pesa mais que usuário; palavras juntas ganham", () => {
    expect(matchEntries(list, "github")[0].title).toBe("GitHub");
    expect(matchEntries(list, "banco brasil")[0].title).toBe("Banco do Brasil");
    expect(matchEntries(list, "ana")[0].title).toBeDefined();
    expect(matchEntries(list, "xyz")).toEqual([]);
    expect(matchEntries(list, "a")).toEqual([]);
  });
});

import { isVaultHome, isVaultLock, looksLikeSharedSecret, vaultQuery } from "../src/modules/channels/assistant/vault-command";
import { normalize } from "../src/modules/channels/assistant/voice";

describe("pedidos do cofre pelo WhatsApp", () => {
  const q = (t: string) => vaultQuery(normalize(t));
  it("extrai o nome do site", () => {
    expect(q("senha do github")).toBe("github");
    expect(q("Qual a senha do meu banco?")).toBe("banco");
    expect(q("me passa o login do Instagram")).toBe("instagram");
    expect(q("me manda a senha da conta netflix")).toBe("netflix");
    expect(q("preciso da senha do gmail")).toBe("gmail");
    expect(q("credenciais do servidor aws")).toBe("servidor aws");
  });
  it("ignora o que não é pedido de senha", () => {
    expect(q("senha")).toBeNull();
    expect(q("o que tenho na agenda")).toBeNull();
    expect(q("recuperar minha conta")).toBeNull();
  });
  it("comandos do cofre", () => {
    expect(isVaultHome(normalize("cofre"))).toBe(true);
    expect(isVaultHome(normalize("abrir cofre de senhas"))).toBe(true);
    expect(isVaultLock(normalize("bloquear cofre"))).toBe(true);
    expect(isVaultLock(normalize("bloquear"))).toBe(false);
  });
  it("avisa quando alguém digita uma senha no chat, sem acusar frases comuns", () => {
    for (const t of ["minha senha é Abc123!x", "senha do banco: x9#kd2ab", "a senha é 12345678", "password = P@ssw0rd!"]) expect(looksLikeSharedSecret(t)).toBe(true);
    for (const t of ["senha do github", "qual é a senha do gmail", "me passa a senha do gmail, é rápido", "a senha é fácil de lembrar", "preciso trocar a senha"]) expect(looksLikeSharedSecret(t)).toBe(false);
  });
});

// ─── Esqueci a senha mestra ─────────────────────────────────────

const linkToken = () => /token=([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1].text)![1];

async function withData() {
  const { recoveryKey } = await svc.setup("u1", "w1", PW);
  await svc.unlock("u1", PW);
  const a = await svc.save("u1", undefined, gh);
  await svc.save("u1", undefined, { ...gh, title: "Netflix" });
  svc.lock("u1");
  return { recoveryKey, entryId: a.id };
}

describe("chave de recuperação", () => {
  it("o cofre nasce com uma chave de recuperação, que aparece uma vez e não é gravada em claro", async () => {
    const { recoveryKey } = await svc.setup("u1", "w1", PW);
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(JSON.stringify(vaults)).not.toContain(recoveryKey);
    expect(JSON.stringify(vaults)).not.toContain(recoveryKey.replace(/-/g, ""));
    expect((await svc.status("u1")).hasRecovery).toBe(true);
  });

  it("gerar outra chave exige a senha mestra e invalida a anterior", async () => {
    const { recoveryKey: old } = await svc.setup("u1", "w1", PW);
    await expect(svc.regenerateRecoveryKey("u1", "Errada-Horse-9!!")).rejects.toThrow("incorreta");
    const { recoveryKey: fresh } = await svc.regenerateRecoveryKey("u1", PW);
    expect(fresh).not.toBe(old);
    await svc.requestReset("u1");
    await expect(svc.recoverWithKey("u1", linkToken(), old, "Nova-Frase-Forte-3!")).rejects.toThrow("incorreta");
    await expect(svc.recoverWithKey("u1", linkToken(), fresh, "Nova-Frase-Forte-3!")).resolves.toBeDefined();
  });
});

describe("pedir o link por e-mail", () => {
  it("manda para o e-mail cadastrado, pela conta Google, sem entregar o link na resposta", async () => {
    await svc.setup("u1", "w1", PW);
    const r = await svc.requestReset("u1");
    expect(r).toEqual({ sentTo: "a***@gmail.com", expiresMinutes: 30 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ana.souza@gmail.com");
    expect(sent[0].text).toContain("/dashboard/vault/reset?token=");
    expect(JSON.stringify(r)).not.toContain("token");
  });

  it("no servidor fica só o hash do token, nunca o token", async () => {
    await svc.setup("u1", "w1", PW);
    await svc.requestReset("u1");
    const token = linkToken();
    expect(JSON.stringify([...kv.entries()])).not.toContain(token);
    expect([...kv.keys()].some((k) => k.startsWith("vaultreset:"))).toBe(true);
  });

  it("sem conta Google ou com falha no envio: avisa e não deixa link solto", async () => {
    await svc.setup("u1", "w1", PW);
    google.accounts = [];
    await expect(svc.requestReset("u1")).rejects.toThrow("Conecte uma conta Google");
    google.accounts = ["a@gmail.com"];
    google.fail = true;
    await expect(svc.requestReset("u1")).rejects.toThrow("Não consegui enviar");
    expect([...kv.keys()].filter((k) => k.startsWith("vaultreset:"))).toEqual([]);
  });

  it("limita a 3 pedidos por hora e só o link mais recente vale", async () => {
    await svc.setup("u1", "w1", PW);
    await svc.requestReset("u1");
    const first = linkToken();
    await svc.requestReset("u1");
    const second = linkToken();
    expect(second).not.toBe(first);
    await expect(svc.resetEmpty("u1", first, "APAGAR", "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
    await svc.requestReset("u1");
    await expect(svc.requestReset("u1")).rejects.toThrow("Muitos pedidos");
  });

  it("sem cofre, não há o que recuperar", async () => {
    await expect(svc.requestReset("u1")).rejects.toThrow("não criou");
  });
});

describe("recuperar com a chave: as senhas ficam", () => {
  it("define nova senha mestra, mantém as entradas, troca a chave e encerra as sessões", async () => {
    const { recoveryKey, entryId } = await withData();
    await svc.requestReset("u1");
    const token = linkToken();
    const r = await svc.recoverWithKey("u1", token, recoveryKey.toLowerCase().replace(/-/g, " "), "Nova-Frase-Forte-3!");
    expect(r.recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(r.recoveryKey).not.toBe(recoveryKey);
    expect(sent[sent.length - 1].subject).toContain("foi redefinida");

    await expect(svc.unlock("u1", PW)).rejects.toThrow("incorreta"); // senha antiga não vale mais
    await svc.unlock("u1", "Nova-Frase-Forte-3!");
    expect((await svc.reveal("u1", entryId)).password).toBe(gh.password);
    expect((await svc.verify("u1")).ok).toBe(true);
  });

  it("a chave antiga deixa de valer depois do uso, e o link só funciona uma vez", async () => {
    const { recoveryKey } = await withData();
    await svc.requestReset("u1");
    const token = linkToken();
    await svc.recoverWithKey("u1", token, recoveryKey, "Nova-Frase-Forte-3!");
    await expect(svc.recoverWithKey("u1", token, recoveryKey, "Outra-Frase-Forte-4!")).rejects.toThrow("inválido ou expirado");
    await svc.requestReset("u1");
    await expect(svc.recoverWithKey("u1", linkToken(), recoveryKey, "Outra-Frase-Forte-4!")).rejects.toThrow("incorreta");
  });

  it("chave errada não abre; 5 erros invalidam o link", async () => {
    const { recoveryKey } = await withData();
    await svc.requestReset("u1");
    const token = linkToken();
    for (let i = 0; i < 4; i++) await expect(svc.recoverWithKey("u1", token, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", "Nova-Frase-Forte-3!")).rejects.toThrow("incorreta");
    await expect(svc.recoverWithKey("u1", token, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", "Nova-Frase-Forte-3!")).rejects.toThrow("invalidado");
    // mesmo com a chave certa, o link já foi gasto
    await expect(svc.recoverWithKey("u1", token, recoveryKey, "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
  });

  it("senha nova fraca não gasta o link", async () => {
    const { recoveryKey } = await withData();
    await svc.requestReset("u1");
    const token = linkToken();
    await expect(svc.recoverWithKey("u1", token, recoveryKey, "fraca")).rejects.toThrow("12 caracteres");
    await expect(svc.recoverWithKey("u1", token, recoveryKey, "Nova-Frase-Forte-3!")).resolves.toBeDefined();
  });

  it("o link de outra pessoa, expirado ou inventado não serve", async () => {
    const { recoveryKey } = await withData();
    await svc.requestReset("u1");
    const token = linkToken();
    await svc.setup("u2", "w1", "Outra-Frase-Forte-7!");
    await expect(svc.recoverWithKey("u2", token, recoveryKey, "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
    await expect(svc.recoverWithKey("u1", "x".repeat(43), recoveryKey, "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
    await expect(svc.recoverWithKey("u1", "curto", recoveryKey, "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
    const rec = kv.get([...kv.keys()].find((k) => k.startsWith("vaultreset:"))!);
    rec.exp = Date.now() - 1;
    await expect(svc.recoverWithKey("u1", token, recoveryKey, "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
  });

  it("só o e-mail (sem a chave) nunca abre o cofre", async () => {
    await withData();
    await svc.requestReset("u1");
    const token = linkToken();
    await expect(svc.recoverWithKey("u1", token, "", "Nova-Frase-Forte-3!")).rejects.toThrow();
    await expect(svc.recoverWithKey("u1", token, "não sei", "Nova-Frase-Forte-3!")).rejects.toThrow("incorreta");
    await expect(svc.unlock("u1", "Nova-Frase-Forte-3!")).rejects.toThrow("incorreta");
  });
});

describe("recomeçar com cofre vazio (sem a chave)", () => {
  it("exige digitar APAGAR e destrói tudo do cofre antigo", async () => {
    const { entryId } = await withData();
    expect(blocks.length).toBeGreaterThan(0);
    await svc.requestReset("u1");
    const token = linkToken();
    await expect(svc.resetEmpty("u1", token, "sim", "Nova-Frase-Forte-3!")).rejects.toThrow("APAGAR");
    expect(blocks.length).toBeGreaterThan(0); // nada foi apagado ainda

    const r = await svc.resetEmpty("u1", token, "APAGAR", "Nova-Frase-Forte-3!");
    expect(r.recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(blocks).toHaveLength(0);
    expect(vaults).toHaveLength(1);
    expect(sent[sent.length - 1].text).toContain("vazio");

    await expect(svc.unlock("u1", PW)).rejects.toThrow("incorreta");
    await svc.unlock("u1", "Nova-Frase-Forte-3!");
    expect(await svc.list("u1")).toEqual([]);
    await expect(svc.reveal("u1", entryId)).rejects.toThrow("não encontrada");
  });

  it("também exige o link válido", async () => {
    await withData();
    await expect(svc.resetEmpty("u1", "y".repeat(43), "APAGAR", "Nova-Frase-Forte-3!")).rejects.toThrow("inválido ou expirado");
    expect(blocks.length).toBeGreaterThan(0);
  });
});
