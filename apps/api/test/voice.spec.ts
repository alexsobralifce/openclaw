import { describe, expect, it } from "vitest";
import { parseChoice, pickByLabel } from "../src/modules/channels/assistant/voice";
import { toSpeech } from "../src/modules/channels/assistant/speech";

describe("escolhas faladas", () => {
  it("números, palavras e ordinais, com a pontuação que o ditado acrescenta", () => {
    expect(parseChoice("2")).toBe(2);
    expect(parseChoice("Dois.")).toBe(2);
    expect(parseChoice("Opção três")).toBe(3);
    expect(parseChoice("número 1")).toBe(1);
    expect(parseChoice("a segunda")).toBe(2);
    expect(parseChoice("quero a primeira opção")).toBe(1);
    expect(parseChoice("abrir o quarto e-mail")).toBe(4);
    expect(parseChoice("o último", 5)).toBe(5);
    expect(parseChoice("o último")).toBeNull();
  });

  it("frases comuns não viram escolha", () => {
    expect(parseChoice("quais reuniões tenho amanhã")).toBeNull();
    expect(parseChoice("responde que chego às 3")).toBeNull();
  });

  it("escolhe pelo nome, só quando há um único candidato", () => {
    const labels = ["João Silva Orçamento da obra", "Maria Souza Reunião", "João Pedro Boleto"];
    expect(pickByLabel("a da Maria", labels)).toBe(2);
    expect(pickByLabel("o do João", labels)).toBeNull();
    expect(pickByLabel("boleto", labels)).toBe(3);
    expect(pickByLabel("agenda", ["E-mails", "Google Agenda", "Conversas de clientes"])).toBe(2);
    // frase longa é pedido livre à IA, não seleção
    expect(pickByLabel("me diga o que a Maria quer na reunião de amanhã cedo", labels)).toBeNull();
  });
});

describe("toSpeech (leitura no carro)", () => {
  it("lê ações curtas como lista de comandos", () => {
    const text = "📩 *Novo e-mail*\n━━━━\n👤 *De:* Ana\n1️⃣ 📖 Ler\n2️⃣ 🗑️ Apagar";
    expect(toSpeech(text)).toBe("Novo e-mail. De: Ana. Diga: ler ou apagar.");
  });

  it("lê listas com número e detalhe de cada item", () => {
    const text = "📧 *E-mails não lidos*\n━━━━\n1️⃣ 👤 *Ana*\n     📌 Orçamento\n\n2️⃣ 👤 *Bruno*\n     📌 Boleto\n━━━━\n💡 _dica_\n0️⃣ ⬅️ Voltar";
    expect(toSpeech(text)).toBe("E-mails não lidos. um, Ana, Orçamento. dois, Bruno, Boleto. Diga o número.");
  });

  it("não pede para dizer \"voltar\" quando é a única opção", () => {
    expect(toSpeech("⏰ *Lembrete*\nReunião às 3\n0️⃣ ⬅️ Voltar")).toBe("Lembrete. Reunião às 3");
  });

  it("nunca corta as instruções finais", () => {
    const long = `${"Frase comprida de teste. ".repeat(60)}\n1️⃣ ✅ Confirmar\n2️⃣ ❌ Cancelar`;
    const out = toSpeech(long);
    expect(out.length).toBeLessThanOrEqual(350);
    expect(out.endsWith("Diga: confirmar ou cancelar.")).toBe(true);
  });
});
