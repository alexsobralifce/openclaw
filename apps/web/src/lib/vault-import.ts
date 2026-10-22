// Reconhece uma lista de senhas colada de uma vez, só no navegador: nada sai da página antes de o usuário confirmar.
export type ImportRow = { title: string; url: string; username: string; password: string; notes: string; whatsapp: boolean };

const KEYS: Record<string, keyof ImportRow> = {
  site: "title", servico: "title", serviço: "title", nome: "title", titulo: "title", título: "title", conta: "title", app: "title",
  url: "url", link: "url", endereco: "url", endereço: "url",
  usuario: "username", usuário: "username", user: "username", login: "username", email: "username", "e-mail": "username",
  senha: "password", password: "password", pass: "password", pwd: "password",
  obs: "notes", observacao: "notes", observação: "notes", nota: "notes", notas: "notes",
};

const blank = (): ImportRow => ({ title: "", url: "", username: "", password: "", notes: "", whatsapp: true });
const looksUrl = (s: string) => /^(https?:\/\/|www\.)\S+$/i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s) && !s.includes("@");

function host(u: string) {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/** Preenche o título pelo endereço quando só o endereço veio. */
function finish(r: ImportRow): ImportRow {
  if (!r.title && r.url) r.title = host(r.url);
  return r;
}

function fromLabeled(lines: string[]): ImportRow | null {
  const r = blank();
  let hit = 0;
  for (const line of lines) {
    const m = line.match(/^\s*([\p{L}-]+)\s*[:=]\s*(.*)$/u);
    const key = m && KEYS[m[1].toLowerCase()];
    if (m && key) {
      const v = m[2].trim();
      if (key === "notes" && r.notes) r.notes += `\n${v}`;
      else r[key as "title"] = v as never;
      hit++;
    } else if (line.trim()) {
      r.notes += (r.notes ? "\n" : "") + line.trim();
    }
  }
  return hit ? finish(r) : null;
}

function fromLine(line: string): ImportRow {
  const sep = line.includes("|") ? /\s*\|\s*/ : line.includes("\t") ? /\t+/ : line.includes(";") ? /\s*;\s*/ : / +[-–—] +|,\s*/;
  let parts = line.split(sep).map((p) => p.trim()).filter(Boolean);
  // "site: usuario / senha"
  if (parts.length === 1) {
    const m = line.match(/^(.+?):\s*(\S+)\s*[/\s]\s*(\S+)$/);
    parts = m ? [m[1], m[2], m[3]] : line.split(/\s+/);
  }
  const r = blank();
  const rest: string[] = [];
  for (const p of parts) {
    if (!r.url && looksUrl(p)) r.url = p;
    else rest.push(p);
  }
  // Ordem natural: nome, usuário, senha. Com duas partes, a segunda é a senha.
  if (r.url && rest.length === 1) [r.password] = rest;
  else if (rest.length === 2 && !r.url) [r.title, r.password] = rest;
  else if (rest.length === 2) [r.username, r.password] = rest;
  else {
    [r.title = "", r.username = "", r.password = ""] = rest;
    r.notes = rest.slice(3).join(" ");
  }
  return finish(r);
}

/** Cada bloco separado por linha em branco com rótulos ("Site: …", "Senha: …") vira uma entrada; fora isso, cada linha é uma. */
export function parsePasswordList(text: string): ImportRow[] {
  const out: ImportRow[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const labeled = fromLabeled(lines);
    if (labeled) out.push(labeled);
    else for (const l of lines) out.push(fromLine(l));
  }
  return out;
}

/** O que impede de salvar a linha (o servidor exige o nome; sem senha a entrada não serve). */
export function rowProblem(r: ImportRow): string | null {
  if (!r.title.trim()) return "falta o nome";
  if (!r.password) return "falta a senha";
  return null;
}
