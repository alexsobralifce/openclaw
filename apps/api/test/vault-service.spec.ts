
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
