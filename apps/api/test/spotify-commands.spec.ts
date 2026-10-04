import { describe, expect, it } from "vitest";
import { cleanQueries, SpotifyCmd, spotifyCommand } from "../src/modules/channels/spotify/spotify-commands";
import { confidentIndex } from "../src/modules/channels/spotify/spotify-assistant";
import { normalize } from "../src/modules/channels/assistant/voice";

const cmd = (t: string): SpotifyCmd | null => spotifyCommand(normalize(t));

describe("comandos do Spotify", () => {
  it("reconhece o que o dono diz", () => {
    const table: [string, SpotifyCmd][] = [
      ["tocar catingueira", { kind: "play", query: "catingueira" }],
      ["Toca a música Evidências da Legião Urbana", { kind: "play", query: "evidencias da legiao urbana" }],
      ["quero ouvir Marinês no Spotify", { kind: "play", query: "marines" }],
      ["tocar", { kind: "resume" }],
      ["continuar", { kind: "resume" }],
      ["pausar", { kind: "pause" }],
      ["pular música", { kind: "next" }],
      ["próxima faixa", { kind: "next" }],
      ["música anterior", { kind: "previous" }],
      ["volume 40", { kind: "volume", percent: 40 }],
      ["colocar o volume em 70%", { kind: "volume", percent: 70 }],
      ["volume 250", { kind: "volume", percent: 100 }],
      ["mudo", { kind: "volume", percent: 0 }],
      ["o que está tocando?", { kind: "now" }],
      ["meus aparelhos", { kind: "devices" }],
      ["criar playlist para estudar", { kind: "playlist", subject: "estudar" }],
      ["crie uma playlist de forró", { kind: "playlist", subject: "forro" }],
      ["músicas sobre saudade", { kind: "about", subject: "saudade" }],
      ["música para o clima de hoje", { kind: "mood" }],
      ["toca alguma coisa", { kind: "mood" }],
      ["spotify", { kind: "home" }],
    ];
    for (const [text, want] of table) expect(cmd(text), text).toEqual(want);
  });

  it("não sequestra o que é de outro assunto", () => {
    for (const t of ["próximo", "o que tenho na agenda hoje", "quero a música catingueira", "baixe a música catingueira", "tocar a música do drive", "mandar o pdf da playlist", "anota tocar violão", "e-mails de hoje", "para quem é esse e-mail", "volume do contrato"]) {
      expect(cmd(t), t).toBeNull();
    }
  });
});

describe("apoio do assistente do Spotify", () => {
  const track = (name: string, artists = "Artista") => ({ uri: `spotify:track:${name}`, name, artists, album: "" });

  it("toca direto só quando o primeiro resultado contém tudo e o segundo não", () => {
    expect(confidentIndex("catingueira marines", [track("Catingueira", "Marinês"), track("Outra", "Fulano")])).toBe(0);
    expect(confidentIndex("evidencias", [track("Evidências", "Legião"), track("Evidências", "Chitãozinho")])).toBeNull(); // dúvida: pergunta
    expect(confidentIndex("", [track("x")])).toBeNull();
  });

  it("limpa as consultas que vêm da IA: curtas, sem repetir, no máximo 8", () => {
    expect(cleanQueries(['"forró pé de serra"', "forró pé de serra", " ", "a", "x".repeat(200), 42, null])).toEqual(["forró pé de serra", "x".repeat(60), "42"]);
    expect(cleanQueries(Array.from({ length: 20 }, (_, i) => `consulta ${i}`))).toHaveLength(8);
    expect(cleanQueries("não é lista")).toEqual([]);
  });
});
