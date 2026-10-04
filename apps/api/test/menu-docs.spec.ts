import { describe, expect, it } from "vitest";
import { countDocs, DocNode, filterDocs, MENU_DOCS } from "../../web/src/lib/menu-docs";
import { MENU_ITEMS } from "../src/modules/channels/assistant/menu-items";

const all = (nodes: DocNode[]): DocNode[] => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
const subtree = (n: DocNode) => all([n]);

describe("documentação do menu do assistente", () => {
  const topIds = MENU_DOCS.map((n) => n.id);

  it("todo item do menu está documentado (item novo no menu sem texto aqui faz este teste falhar)", () => {
    // O Modo carro está desativado (CAR_MODE), então não entra na ajuda
    const menuIds = MENU_ITEMS.map((i) => i.id).filter((id) => id !== "car");
    for (const id of menuIds) expect(topIds, `item "${id}" do menu sem documentação`).toContain(id);
  });

  it("não documenta item que não existe no menu (fora a introdução)", () => {
    const menuIds = new Set(MENU_ITEMS.map((i) => i.id));
    for (const id of topIds.filter((x) => x !== "como-funciona")) expect(menuIds.has(id), `"${id}" não é um item do menu`).toBe(true);
    expect(topIds).not.toContain("car");
  });

  it("os identificadores são únicos (servem de âncora)", () => {
    const ids = all(MENU_DOCS).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cada item tem título e explicação", () => {
    for (const n of all(MENU_DOCS)) {
      expect(n.title.trim(), n.id).not.toBe("");
      expect(n.summary.trim().length, n.id).toBeGreaterThan(10);
    }
  });

  it("cada item do menu explica como adicionar e como apagar", () => {
    for (const top of MENU_DOCS.filter((n) => n.id !== "como-funciona")) {
      const nodes = subtree(top);
      expect(nodes.some((n) => !!n.add), `"${top.id}" sem “como adicionar”`).toBe(true);
      expect(nodes.some((n) => !!n.remove), `"${top.id}" sem “como apagar”`).toBe(true);
    }
  });

  it("diz com todas as letras o que o assistente apaga e o que NÃO apaga", async () => {
    const byId = Object.fromEntries(MENU_DOCS.map((n) => [n.id, n]));
    // apaga evento e conclui nota (lixeira do Drive), mas não edita evento
    expect(byId.agenda.remove).toMatch(/apagar evento/);
    expect(byId.agenda.limits).toMatch(/não edita/);
    expect(byId.notes.remove).toMatch(/lixeira do Drive/);
    expect(byId.notes.limits).toMatch(/que ele mesmo criou/);
    // não apaga arquivo do Drive nem contato, e o cofre é só pelo painel
    expect(byId.drive.remove).toMatch(/não apaga/);
    expect(byId.contacts.remove).toMatch(/só lê/);
    expect(byId.vault.remove).toMatch(/painel web/);
  });

  it("os passos de apagar evento e concluir nota existem como itens da árvore", () => {
    const ids = all(MENU_DOCS).map((n) => n.id);
    expect(ids).toContain("agenda-apagar");
    expect(ids).toContain("notes-concluir");
  });

  it("os exemplos do que dizer não estão vazios nem repetidos no mesmo item", () => {
    for (const n of all(MENU_DOCS)) {
      if (!n.say) continue;
      expect(n.say.length, n.id).toBeGreaterThan(0);
      expect(new Set(n.say).size, n.id).toBe(n.say.length);
    }
  });
});

describe("busca na ajuda", () => {
  it("sem busca devolve tudo; sem acerto devolve nada", () => {
    expect(filterDocs(MENU_DOCS, "")).toBe(MENU_DOCS);
    expect(filterDocs(MENU_DOCS, "   ")).toBe(MENU_DOCS);
    expect(filterDocs(MENU_DOCS, "zzzxxxqqq")).toEqual([]);
  });

  it("ignora acento e maiúscula e acha o item certo", () => {
    const ids = (q: string) => filterDocs(MENU_DOCS, q).map((n) => n.id);
    expect(ids("MUSICA")).toContain("drive");
    expect(ids("Música")).toContain("drive");
    expect(ids("arnaud")).toContain("contacts");
    expect(ids("cofre")).toContain("vault");
  });

  it("mostra o caminho até o filho que casa, só com os filhos que casam", () => {
    const r = filterDocs(MENU_DOCS, "lixeira");
    const email = r.find((n) => n.id === "email")!;
    expect(email).toBeTruthy();
    expect(email.children?.length).toBeGreaterThan(0);
    expect(email.children!.every((c) => /lixeira/.test(JSON.stringify(c).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()))).toBe(true);
    expect(email.children!.length).toBeLessThan(MENU_DOCS.find((n) => n.id === "email")!.children!.length);
  });

  it("várias palavras: todas precisam estar no mesmo item", () => {
    expect(filterDocs(MENU_DOCS, "apagar lote").map((n) => n.id)).toContain("email");
    expect(filterDocs(MENU_DOCS, "cofre agenda").length).toBe(0);
  });

  it("conta os itens de todos os níveis", () => {
    expect(countDocs(MENU_DOCS)).toBe(all(MENU_DOCS).length);
    expect(countDocs([])).toBe(0);
  });
});
