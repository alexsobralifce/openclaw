import { describe, expect, it, vi } from "vitest";

vi.mock("@openclaw/database", () => ({ prisma: {} }));

import { TOOLS } from "../src/modules/channels/assistant/assistant.service";
import { GROUPED_TOOLS, selectToolNames } from "../src/modules/channels/assistant/tool-select";

const names = (t: string) => [...(selectToolNames(t) ?? [])].sort();

describe("ferramentas enviadas à IA livre", () => {
  it("toda ferramenta pertence a algum assunto (senão ela nunca seria enviada)", () => {
    const all = TOOLS.map((t) => t.function.name);
    expect(all.filter((n) => !GROUPED_TOOLS.has(n))).toEqual([]);
    expect([...GROUPED_TOOLS].filter((n) => !all.includes(n))).toEqual([]);
  });

  it("pedido de um assunto manda só as ferramentas dele", () => {
    expect(names("como está o tempo amanhã?")).toEqual(expect.arrayContaining(["get_weather", "set_location"]));
    expect(names("vai chover hoje?")).not.toContain("gmail_send");
    expect(names("anota que preciso comprar café")).toEqual(["note_add", "note_search"]);
    expect(names("o que anotei sobre o contrato?")).toEqual(expect.arrayContaining(["note_search"]));
  });

  it("e-mail traz a busca de contatos; arquivo traz e-mail (pode ir anexo)", () => {
    expect(names("responde o email do Marcos")).toEqual(expect.arrayContaining(["gmail_read", "gmail_send", "contact_search"]));
    expect(names("manda o contrato pro Marcos")).toEqual(expect.arrayContaining(["drive_search", "drive_send_file", "gmail_send"]));
  });

  it("agenda reconhece criar e listar", () => {
    expect(names("marca uma reunião sexta às 10h")).toEqual(expect.arrayContaining(["calendar_create_event", "calendar_list_events"]));
  });

  it("sem assunto reconhecido, ou assunto demais, vão todas (null)", () => {
    expect(selectToolNames("oi, tudo bem?")).toBeNull();
    expect(selectToolNames("me explica como funciona a fotossíntese")).toBeNull();
    expect(selectToolNames("vê meus emails, a agenda, o clima, anota isso e lembra a rotina de academia")).toBeNull();
  });

  it("acento e maiúscula não atrapalham", () => {
    expect(names("QUAL É A MINHA AGENDA?")).toEqual(expect.arrayContaining(["calendar_list_events"]));
    expect(names("Previsão do tempo")).toEqual(expect.arrayContaining(["get_weather"]));
  });

  it("o conjunto escolhido é bem menor que o total", () => {
    const total = JSON.stringify(TOOLS).length;
    const some = TOOLS.filter((t) => selectToolNames("anota ligar pro Marcos")!.has(t.function.name));
    expect(JSON.stringify(some).length).toBeLessThan(total * 0.25);
  });
});
