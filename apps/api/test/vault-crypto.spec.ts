import { describe, expect, it } from "vitest";
import {
  newPinSalt, newWaKey, openEntryWa, pinKek, pinProblem, sealEntryWa, unwrapWaKeyMaster, unwrapWaKeyPin, wrapWaKeyMaster, wrapWaKeyPin,
  hashResetToken, maskEmail, newRecoveryKey, newRecoverySalt, newResetToken, parseRecoveryKey, recoveryKek, resetTokenShape, unwrapVaultKeyRecovery, wrapVaultKeyRecovery,
  assertKdf, blockHash, checkEntry, deriveKek, GENESIS, liveEntries, masterPasswordProblem, newKdf, newVaultKey, open, openEntry,
  seal, sealEntry, sha256, StoredBlock, subkeys, unwrapVaultKey, verifyChain, wrapVaultKey,
} from "../src/modules/vault/vault-crypto";

const entry = { title: "GitHub", url: "https://github.com", username: "ana@x.com", password: "s3nh@-Forte!", notes: "2FA no app", whatsapp: true };

describe("cifra", () => {
  const key = newVaultKey();

  it("ida e volta; IV novo a cada cifra", () => {
    const a = seal(key, "segredo", "ctx");
    const b = seal(key, "segredo", "ctx");
    expect(a).not.toBe(b);
    expect(open(key, a, "ctx").toString()).toBe("segredo");
    expect(a).not.toContain("segredo");
  });

  it("chave errada, contexto errado ou byte alterado são recusados", () => {
    const s = seal(key, "segredo", "ctx");
    expect(() => open(newVaultKey(), s, "ctx")).toThrow();
    expect(() => open(key, s, "outro")).toThrow();
    const [v, iv, tag, ct] = s.split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() => open(key, [v, iv, tag, flipped.toString("base64")].join("."), "ctx")).toThrow();
    expect(() => open(key, "lixo", "ctx")).toThrow();
  });

  it("a entrada só abre no seu próprio cofre, entrada e bloco", () => {
    const enc = subkeys(key).enc;
    const sealed = sealEntry(enc, "v1", "e1", 3, entry);
    expect(openEntry(enc, "v1", "e1", 3, sealed)).toEqual(entry);
    expect(() => openEntry(enc, "v1", "e2", 3, sealed)).toThrow(); // trocada de entrada
    expect(() => openEntry(enc, "v1", "e1", 4, sealed)).toThrow(); // trocada de bloco
    expect(() => openEntry(enc, "v2", "e1", 3, sealed)).toThrow(); // trocada de cofre
    expect(sealed).not.toContain("s3nh");
  });

  it("subchaves são determinísticas e diferentes entre si", () => {
    const a = subkeys(key);
    const b = subkeys(key);
    expect(a.enc.equals(b.enc)).toBe(true);
    expect(a.enc.equals(a.mac)).toBe(false);
    expect(a.enc.equals(key)).toBe(false);
  });
});

describe("senha mestra e derivação de chave", () => {
  it("a mesma senha e sal dão a mesma chave; outra senha dá outra", async () => {
    const kdf = newKdf();
    const a = await deriveKek("uma frase bem comprida 123!", kdf);
    expect(a.equals(await deriveKek("uma frase bem comprida 123!", kdf))).toBe(true);
    expect(a.equals(await deriveKek("uma frase bem comprida 124!", kdf))).toBe(false);
    expect(a.equals(await deriveKek("uma frase bem comprida 123!", newKdf()))).toBe(false);
  });

  it("a chave do cofre só abre com a senha certa", async () => {
    const kdf = newKdf();
    const vk = newVaultKey();
    const wrapped = wrapVaultKey(await deriveKek("Correta-Horse-9!", kdf), vk, "v1");
    expect(unwrapVaultKey(await deriveKek("Correta-Horse-9!", kdf), wrapped, "v1").equals(vk)).toBe(true);
    await expect(async () => unwrapVaultKey(await deriveKek("Errada-Horse-9!!", kdf), wrapped, "v1")).rejects.toThrow();
    expect(() => unwrapVaultKey(vk, wrapped, "v2")).toThrow();
  });

  it("recusa parâmetros adulterados no banco", () => {
    expect(() => assertKdf({ ...newKdf(), N: 2 ** 30 })).toThrow();
    expect(() => assertKdf({ ...newKdf(), N: 1000 })).toThrow();
    expect(() => assertKdf({ ...newKdf(), r: 1 })).toThrow();
    expect(() => assertKdf({ ...newKdf(), salt: "AAAA" })).toThrow();
    expect(() => assertKdf(newKdf())).not.toThrow();
  });

  it("regras da senha mestra", () => {
    for (const bad of ["curta1!A", "aaaaaaaaaaaaaaaa", "somenteminusculas", "Senha123456"]) expect(masterPasswordProblem(bad)).not.toBe("");
    for (const good of ["Correta-Horse-9!", "uma frase longa sem simbolos nenhum"]) expect(masterPasswordProblem(good)).toBe("");
  });
});

describe("validação das entradas", () => {
  it("exige título e respeita limites", () => {
    expect(checkEntry({ password: "x" })).toMatchObject({ ok: false });
    expect(checkEntry({ title: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(checkEntry({ title: "  Netflix ", password: "abc" })).toMatchObject({ ok: true, data: { title: "Netflix", password: "abc", url: "", notes: "" } });
  });
});

// Monta uma cadeia como o serviço faz
function build(mac: Buffer, n: number, vaultId = "v1") {
  const blocks: StoredBlock[] = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const payload = `payload-${i}`;
    const core = { vaultId, seq: i, prevHash: prev, op: "put" as const, entryId: `e${i}`, payloadHash: sha256(payload) };
    const hash = blockHash(mac, core);
    blocks.push({ seq: i, prevHash: prev, op: "put", entryId: core.entryId, payload, payloadHash: core.payloadHash, hash });
    prev = hash;
  }
  return { blocks, head: { seq: n, hash: n ? prev : "" } };
}

describe("cadeia de hashes com chave", () => {
  const mac = subkeys(newVaultKey()).mac;

  it("cadeia íntegra passa; cofre vazio também", () => {
    const { blocks, head } = build(mac, 5);
    expect(verifyChain(mac, "v1", blocks, head)).toMatchObject({ ok: true, checked: 5 });
    expect(verifyChain(mac, "v1", [], { seq: 0, hash: "" }).ok).toBe(true);
  });

  it("apagar o conteúdo antigo (como ao atualizar/excluir uma entrada) não quebra a cadeia", () => {
    const { blocks, head } = build(mac, 4);
    blocks[1] = { ...blocks[1], payload: "" };
    expect(verifyChain(mac, "v1", blocks, head).ok).toBe(true);
  });

  it("detecta conteúdo alterado", () => {
    const { blocks, head } = build(mac, 4);
    blocks[2] = { ...blocks[2], payload: "outro" };
    expect(verifyChain(mac, "v1", blocks, head)).toMatchObject({ ok: false, problem: expect.stringContaining("Bloco 3") });
  });

  it("detecta entrada trocada, operação trocada e bloco do meio removido", () => {
    let t = build(mac, 4);
    t.blocks[1] = { ...t.blocks[1], entryId: "e999" };
    expect(verifyChain(mac, "v1", t.blocks, t.head).ok).toBe(false);
    t = build(mac, 4);
    t.blocks[1] = { ...t.blocks[1], op: "delete" };
    expect(verifyChain(mac, "v1", t.blocks, t.head).ok).toBe(false);
    t = build(mac, 4);
    t.blocks.splice(1, 1);
    expect(verifyChain(mac, "v1", t.blocks, t.head)).toMatchObject({ ok: false, problem: expect.stringContaining("Faltando o bloco 2") });
  });

  it("detecta blocos removidos do fim e acrescentados", () => {
    const t = build(mac, 4);
    expect(verifyChain(mac, "v1", t.blocks.slice(0, 3), t.head).ok).toBe(false);
    const extra = build(mac, 5);
    expect(verifyChain(mac, "v1", extra.blocks, t.head).ok).toBe(false);
  });

  it("detecta blocos reordenados no encadeamento e cadeia de outro cofre", () => {
    const t = build(mac, 4);
    const swapped = [...t.blocks];
    [swapped[1], swapped[2]] = [{ ...swapped[2], seq: 2 }, { ...swapped[1], seq: 3 }];
    expect(verifyChain(mac, "v1", swapped, t.head).ok).toBe(false);
    expect(verifyChain(mac, "outro-cofre", t.blocks, t.head).ok).toBe(false);
  });

  it("quem só tem o banco não consegue refazer a cadeia adulterada (sem a chave de assinatura)", () => {
    const real = build(mac, 4);
    const attackerMac = subkeys(newVaultKey()).mac;
    // O atacante troca o conteúdo do bloco 2 e recalcula TODA a cadeia com uma chave que ele inventou
    const forged = build(attackerMac, 4);
    expect(verifyChain(mac, "v1", forged.blocks, forged.head).ok).toBe(false);
    // ... e o hash puro (sem chave) também não serve
    expect(real.blocks[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(mac, "v1", real.blocks, real.head).ok).toBe(true);
  });
});

describe("estado atual", () => {
  it("vale o último 'put' de cada entrada; 'delete' remove", () => {
    const b = (seq: number, op: string, entryId: string) => ({ seq, op, entryId });
    const live = liveEntries([b(1, "put", "a"), b(2, "put", "b"), b(3, "put", "a"), b(4, "delete", "b"), b(5, "put", "c")]);
    expect(live.map((x) => `${x.entryId}@${x.seq}`)).toEqual(["a@3", "c@5"]);
  });
});

describe("chave de recuperação", () => {
  it("formato, ida e volta e tolerância a digitação", () => {
    const k = newRecoveryKey();
    expect(k.text).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(k.text).not.toMatch(/[ILOU]/);
    expect(parseRecoveryKey(k.text)?.equals(k.bytes)).toBe(true);
    expect(parseRecoveryKey(k.text.toLowerCase().replace(/-/g, " "))?.equals(k.bytes)).toBe(true);
    expect(newRecoveryKey().text).not.toBe(k.text);
  });

  it("recusa o que não é uma chave", () => {
    for (const bad of ["", "ABC", "AAAA-BBBB", "!".repeat(32), "A".repeat(33)]) expect(parseRecoveryKey(bad)).toBeNull();
  });

  it("abre a chave do cofre só com a chave certa e para o cofre certo", () => {
    const vk = newVaultKey();
    const rk = newRecoveryKey();
    const salt = newRecoverySalt();
    const wrapped = wrapVaultKeyRecovery(recoveryKek(rk.bytes, salt), vk, "v1");
    expect(unwrapVaultKeyRecovery(recoveryKek(rk.bytes, salt), wrapped, "v1").equals(vk)).toBe(true);
    expect(() => unwrapVaultKeyRecovery(recoveryKek(newRecoveryKey().bytes, salt), wrapped, "v1")).toThrow();
    expect(() => unwrapVaultKeyRecovery(recoveryKek(rk.bytes, newRecoverySalt()), wrapped, "v1")).toThrow();
    expect(() => unwrapVaultKeyRecovery(recoveryKek(rk.bytes, salt), wrapped, "v2")).toThrow();
  });
});

describe("token do link", () => {
  it("é aleatório, tem o formato esperado e o hash não revela o token", () => {
    const t = newResetToken();
    expect(resetTokenShape(t)).toBe(true);
    expect(resetTokenShape("curto")).toBe(false);
    expect(resetTokenShape(undefined)).toBe(false);
    expect(newResetToken()).not.toBe(t);
    expect(hashResetToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(t)).not.toContain(t);
    expect(hashResetToken(t)).toBe(hashResetToken(t));
  });
  it("mascara o e-mail", () => {
    expect(maskEmail("ana.souza@gmail.com")).toBe("a***@gmail.com");
  });
});

describe("código de 4 dígitos", () => {
  it("aceita 4 números comuns e recusa fracos e mal formados", () => {
    for (const ok of ["4827", "0193", "7391"]) expect(pinProblem(ok)).toBe("");
    for (const bad of ["", "123", "12345", "abcd", "12 4", "1111", "0000", "1234", "4321", "0123", "9876", "1212", "5656"]) expect(pinProblem(bad)).not.toBe("");
    expect(pinProblem(4827 as any)).not.toBe("");
  });

  it("a chave do WhatsApp só abre com o código certo, o mesmo salt e o mesmo segredo do servidor", async () => {
    const kw = newWaKey();
    const salt = newPinSalt();
    const wrapped = wrapWaKeyPin(await pinKek("4827", salt), kw, "v1");
    expect(unwrapWaKeyPin(await pinKek("4827", salt), wrapped, "v1").equals(kw)).toBe(true);
    await expect(async () => unwrapWaKeyPin(await pinKek("4828", salt), wrapped, "v1")).rejects.toThrow();
    await expect(async () => unwrapWaKeyPin(await pinKek("4827", newPinSalt()), wrapped, "v1")).rejects.toThrow();
    await expect(async () => unwrapWaKeyPin(await pinKek("4827", salt), wrapped, "v2")).rejects.toThrow();
    const prev = process.env.VAULT_PEPPER;
    process.env.VAULT_PEPPER = "segredo-diferente";
    try {
      await expect(async () => unwrapWaKeyPin(await pinKek("4827", salt), wrapped, "v1")).rejects.toThrow();
    } finally {
      if (prev === undefined) delete process.env.VAULT_PEPPER;
      else process.env.VAULT_PEPPER = prev;
    }
  });

  it("a cópia do WhatsApp nunca leva as notas e só abre no seu contexto", () => {
    const kw = newWaKey();
    const sealed = sealEntryWa(kw, "v1", "e1", 2, entry);
    expect(sealed).not.toContain("2FA");
    const back = openEntryWa(kw, "v1", "e1", 2, sealed);
    expect(back).toMatchObject({ title: "GitHub", password: "s3nh@-Forte!", notes: "" });
    expect(() => openEntryWa(kw, "v1", "e2", 2, sealed)).toThrow();
    expect(() => openEntryWa(kw, "v1", "e1", 3, sealed)).toThrow();
    expect(() => openEntryWa(newWaKey(), "v1", "e1", 2, sealed)).toThrow();
  });

  it("a chave do WhatsApp também fica guardada pela chave do cofre (o painel cria cópias sem o código)", () => {
    const kw = newWaKey();
    const enc = subkeys(newVaultKey()).enc;
    expect(unwrapWaKeyMaster(enc, wrapWaKeyMaster(enc, kw, "v1"), "v1").equals(kw)).toBe(true);
    expect(() => unwrapWaKeyMaster(subkeys(newVaultKey()).enc, wrapWaKeyMaster(enc, kw, "v1"), "v1")).toThrow();
  });
});
