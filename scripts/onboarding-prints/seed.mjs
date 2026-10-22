// Cria no banco LOCAL (docker-compose.dev.yml, porta 5433) as contas de demonstração dos prints do tour.
// Nada daqui toca em produção: só fala com a API local e com o contêiner `openclaw-postgres-1`.
import { execFileSync } from "node:child_process";

export const API = process.env.PRINTS_API || "http://localhost:3011";
export const DEMO = { email: "ana@magobox.local", name: "Ana Demo", password: "demo-senha-123", ws: "Espaço da Ana" };
export const NOVO = { email: "novo@magobox.local", name: "Novo Usuário", password: "demo-senha-123", ws: "Espaço do Novo" };

const psql = (sql) => execFileSync("docker", ["exec", "openclaw-postgres-1", "psql", "-U", "openclaw", "-d", "openclaw", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });

async function register(u) {
  // o cadastro tem limite de tentativas: só cadastra quem ainda não existe
  const existe = execFileSync("docker", ["exec", "openclaw-postgres-1", "psql", "-U", "openclaw", "-d", "openclaw", "-tA", "-c", `SELECT count(*) FROM "User" WHERE email='${u.email}'`], { encoding: "utf8" }).trim();
  if (existe !== "0") return;
  const r = await fetch(`${API}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, name: u.name, password: u.password, workspaceName: u.ws }) });
  if (!r.ok && r.status !== 409) throw new Error(`cadastro de ${u.email}: HTTP ${r.status} ${await r.text()}`);
}

export async function seed() {
  await register(DEMO);
  await register(NOVO);
  // Ana: plano Mago ativo, e-mail confirmado, tour já visto. O novo usuário fica como um cadastro recém-criado (sem plano).
  psql(`UPDATE "User" SET plan='mago', "planUntil"=NULL, "planRequired"=false, "onboardedAt"=now(), "emailVerifiedAt"=now(), status='ACTIVE', services=ARRAY['assistant','email','calendar','drive','contacts','channels','vault'] WHERE email='${DEMO.email}'`);
  psql(`UPDATE "User" SET plan=NULL, "planUntil"=NULL, "planRequired"=true, "onboardedAt"=NULL, "emailVerifiedAt"=now(), status='ACTIVE', services=ARRAY[]::text[] WHERE email='${NOVO.email}'`);
  // Documentos fictícios da Ana (sem arquivo real no Drive)
  psql(`DELETE FROM "Document" WHERE "workspaceId" IN (SELECT w."workspaceId" FROM "WorkspaceMember" w JOIN "User" u ON u.id=w."userId" WHERE u.email='${DEMO.email}')`);
  const docs = [
    ["Contrato de aluguel", "moradia", "{aluguel,contrato}", "Contrato de locação residencial, vigência de 30 meses."],
    ["Plano de saúde 2026", "saude", "{plano-de-saude,carteirinha}", "Condições do plano e rede credenciada."],
    ["Nota fiscal notebook", "compras", "{nota-fiscal,garantia}", "Garantia de 12 meses a partir da compra."],
    ["Declaração de imposto de renda", "impostos", "{irpf,declaracao}", "Recibo de entrega e comprovantes."],
  ];
  for (const [title, topic, tags, summary] of docs) {
    psql(`INSERT INTO "Document" (id, kind, title, topic, tags, summary, "driveFileId", account, mime, "sizeBytes", pages, origin, "updatedAt", "workspaceId")
      SELECT gen_random_uuid()::text, 'pdf', '${title}', '${topic}', '${tags}', '${summary}', 'demo-' || gen_random_uuid()::text, 'ana@magobox.local', 'application/pdf', 120000, 3, 'app', now(), w."workspaceId"
      FROM "WorkspaceMember" w JOIN "User" u ON u.id=w."userId" WHERE u.email='${DEMO.email}' LIMIT 1`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seed();
  console.log("Contas de demonstração prontas:", DEMO.email, "e", NOVO.email);
}
