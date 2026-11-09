import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { prisma } from "@magobox/database";
import { randomUUID } from "crypto";
import { StateService } from "../state/state.service";
import { GoogleService } from "../integrations/google/google.service";
import {
  BlockOp, blockHash, checkEntry, deriveKek, EntryData, GENESIS, hashResetToken, KdfParams, LIMITS, liveEntries, maskEmail, masterPasswordProblem, newKdf,
  newRecoveryKey, newRecoverySalt, newResetToken, newVaultKey, openEntry, parseRecoveryKey, recoveryKek, resetTokenShape, sealEntry, sha256, subkeys,
  unwrapVaultKey, unwrapVaultKeyRecovery, VaultKeys, verifyChain, wipe, wrapVaultKey, wrapVaultKeyRecovery,
  MAX_PIN_ATTEMPTS, newPinSalt, newWaKey, openEntryWa, openLabel, pinKek, pinProblem, sealEntryWa, sealLabel, unwrapWaKeyMaster, unwrapWaKeyPin, wrapWaKeyMaster, wrapWaKeyPin,
} from "./vault-crypto";

const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60_000;
const DEFAULT_MINUTES = 15;
const MAX_MINUTES = 120;
const RESET_TTL_MS = 30 * 60_000;
/** Depois do código certo, o dono tem este tempo para escolher na lista; ao revelar uma senha o código é gasto. */
const WA_WINDOW_MS = 2 * 60_000;

/** Sem acento, minúsculas: "Instagrám" casa com "instagram". */
const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface EntrySummary {
  id: string;
  title: string;
  url: string;
  username: string;
  hasPassword: boolean;
  hasNotes: boolean;
  whatsapp: boolean;
  updatedAt: Date;
  /** não foi possível abrir: o registro foi alterado ou está corrompido */
  corrupted?: boolean;
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  expiresAt?: number;
  whatsapp?: boolean;
  /** o cofre tem chave de recuperação (permite redefinir a senha mestra sem perder as senhas) */
  hasRecovery?: boolean;
  /** já existe o código de 4 dígitos da consulta pelo WhatsApp */
  hasPin?: boolean;
  /** o WhatsApp foi bloqueado por códigos errados; a senha mestra no painel reativa */
  waLocked?: boolean;
}

/** Entradas que combinam com o que o dono lembra (título, site ou usuário), as mais parecidas primeiro. */
export function matchEntries<T extends { title: string; url: string; username: string }>(entries: T[], query: string, max = 6): T[] {
  const words = flat(query).split(/[^a-z0-9@.]+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  return entries
    .map((e) => {
      const title = flat(e.title);
      const rest = flat(`${e.url} ${e.username}`);
      const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : rest.includes(w) ? 1 : 0), 0);
      return { e, score, all: words.every((w) => title.includes(w) || rest.includes(w)) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => Number(b.all) - Number(a.all) || b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

interface Session {
  keys: VaultKeys;
  vaultId: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

/** Chave do WhatsApp aberta pelo código certo: vale poucos minutos, só na memória. */
interface WaSession {
  kw: Buffer;
  vaultId: string;
  until: number;
  timer: NodeJS.Timeout;
}

/**
 * Cofre de senhas. A senha mestra nunca é gravada: só desbloqueia a chave do cofre na MEMÓRIA deste processo, por um
 * tempo curto. Reiniciar a API bloqueia tudo (é o esperado). Nada aqui recebe ou devolve senha em log.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private sessions = new Map<string, Session>();
  private waSessions = new Map<string, WaSession>();
  private waFails = new Map<string, number>();
  private kdfQueue: Promise<unknown> = Promise.resolve();

  constructor(private state: StateService, private google: GoogleService) {}

  /** A derivação usa ~128 MiB: uma de cada vez, para muitas tentativas juntas não derrubarem o servidor. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.kdfQueue.then(fn, fn);
    this.kdfQueue = run.catch(() => undefined);
    return run;
  }

  private failKey = (userId: string) => `vaultfail:${userId}`;
  private waLockKey = (userId: string) => `vaultwalock:${userId}`;

  private async vaultOf(userId: string) {
    return prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  }

  private lockedError() {
    return new ForbiddenException({ statusCode: 403, code: "VAULT_LOCKED", message: "O cofre está bloqueado. Digite a senha mestra para liberar." });
  }

  private live(userId: string): Session | null {
    const s = this.sessions.get(userId);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      this.destroy(userId);
      return null;
    }
    return s;
  }

  private session(userId: string): Session {
    const s = this.live(userId);
    if (!s) throw this.lockedError();
    return s;
  }

  private destroy(userId: string) {
    const s = this.sessions.get(userId);
    if (!s) return;
    clearTimeout(s.timer);
    wipe(s.keys.enc, s.keys.mac);
    this.sessions.delete(userId);
  }

  // ─── Estado, criação e bloqueio ───────────────────────────────

  async status(userId: string): Promise<VaultStatus> {
    const exists = !!(await this.vaultOf(userId));
    const s = this.live(userId);
    const vault = exists ? await this.vaultOf(userId) : null;
    return {
      exists,
      unlocked: !!s,
      hasRecovery: !!vault?.recoveryWrapped,
      hasPin: !!vault?.waKeyPin,
      waLocked: !!(await this.state.get(this.waLockKey(userId))),
      ...(s ? { expiresAt: s.expiresAt } : {}),
    };
  }

  /** Chave de recuperação nova para esta chave de cofre: cadeado extra + o texto que o dono guarda (mostrado uma vez). */
  private newRecovery(vk: Buffer, vaultId: string) {
    const rk = newRecoveryKey();
    const salt = newRecoverySalt();
    const kek = recoveryKek(rk.bytes, salt);
    try {
      return { recoverySalt: salt, recoveryWrapped: wrapVaultKeyRecovery(kek, vk, vaultId), text: rk.text };
    } finally {
      wipe(kek, rk.bytes);
    }
  }

  /** Monta um cofre novo (chave aleatória, protegida pela senha mestra e pela chave de recuperação) sem gravar nada. */
  private async build(password: string) {
    const id = randomUUID();
    const kdf = newKdf();
    const kek = await this.serial(() => deriveKek(password, kdf));
    const vk = newVaultKey();
    try {
      const rec = this.newRecovery(vk, id);
      return { id, recoveryKey: rec.text, data: { kdf: kdf as any, wrappedKey: wrapVaultKey(kek, vk, id), recoverySalt: rec.recoverySalt, recoveryWrapped: rec.recoveryWrapped } };
    } finally {
      wipe(kek, vk);
    }
  }

  /** Cria o cofre e devolve a chave de recuperação, que só aparece agora. */
  async setup(userId: string, workspaceId: string, password: string): Promise<{ recoveryKey: string }> {
    if (await this.vaultOf(userId)) throw new ConflictException("Você já tem um cofre.");
    const problem = masterPasswordProblem(password);
    if (problem) throw new BadRequestException(problem);
    const built = await this.build(password);
    await prisma.vault.create({ data: { id: built.id, userId, workspaceId, ...built.data } });
    // Duas criações simultâneas: fica só a mais antiga
    if ((await prisma.vault.count({ where: { userId } })) > 1) {
      await prisma.vault.delete({ where: { id: built.id } });
      throw new ConflictException("Você já tem um cofre.");
    }
    this.logger.log(`[AUDIT] vault_created user=${userId}`);
    return { recoveryKey: built.recoveryKey };
  }

  /** Bloqueia depois de MAX_FAILS senhas erradas seguidas, por 15 minutos. */
  private async assertNotLockedOut(userId: string) {
    const fails = await this.state.get<number>(this.failKey(userId));
    if (typeof fails === "number" && fails >= MAX_FAILS) {
      throw new HttpException("Muitas tentativas com a senha mestra. Aguarde 15 minutos.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async unwrap(userId: string, vault: { id: string; kdf: any; wrappedKey: string }, password: string): Promise<Buffer> {
    await this.assertNotLockedOut(userId);
    const kek = await this.serial(() => deriveKek(password, vault.kdf as KdfParams));
    try {
      const vk = unwrapVaultKey(kek, vault.wrappedKey, vault.id);
      await this.state.del(this.failKey(userId));
      return vk;
    } catch {
      const n = await this.state.incr(this.failKey(userId), FAIL_WINDOW_MS);
      this.logger.warn(`[AUDIT] vault_bad_password user=${userId} tentativa=${n}`);
      throw new UnauthorizedException("Senha mestra incorreta.");
    } finally {
      wipe(kek);
    }
  }

  async unlock(userId: string, password: string, minutes = DEFAULT_MINUTES): Promise<VaultStatus> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    const vk = await this.unwrap(userId, vault, String(password ?? ""));
    const ms = Math.min(Math.max(Math.round(Number(minutes) || DEFAULT_MINUTES), 1), MAX_MINUTES) * 60_000;
    this.destroy(userId);
    const keys = subkeys(vk);
    wipe(vk);
    const timer = setTimeout(() => this.destroy(userId), ms);
    timer.unref?.();
    this.sessions.set(userId, { keys, vaultId: vault.id, expiresAt: Date.now() + ms, timer });
    // A senha mestra certa prova que é o dono: reativa o WhatsApp se ele tinha sido bloqueado por códigos errados
    await this.state.del(this.waLockKey(userId));
    this.waFails.delete(userId);
    this.logger.log(`[AUDIT] vault_unlocked user=${userId} minutos=${ms / 60_000}`);
    return this.status(userId);
  }

  lock(userId: string) {
    this.destroy(userId);
    this.logger.log(`[AUDIT] vault_locked user=${userId}`);
  }

  // ─── Entradas ────────────────────────────────────────────────

  private async blocksOf(vaultId: string) {
    return prisma.vaultBlock.findMany({ where: { vaultId }, orderBy: { seq: "asc" } });
  }

  async list(userId: string): Promise<EntrySummary[]> {
    const s = this.session(userId);
    const live = liveEntries(await this.blocksOf(s.vaultId));
    const out: EntrySummary[] = live.map((b) => {
      try {
        const d = openEntry(s.keys.enc, s.vaultId, b.entryId, b.seq, b.payload);
        return { id: b.entryId, title: d.title, url: d.url, username: d.username, hasPassword: !!d.password, hasNotes: !!d.notes, whatsapp: d.whatsapp, updatedAt: b.createdAt };
      } catch {
        return { id: b.entryId, title: "(ilegível)", url: "", username: "", hasPassword: false, hasNotes: false, whatsapp: false, updatedAt: b.createdAt, corrupted: true };
      }
    });
    return out.sort((a, b) => flat(a.title).localeCompare(flat(b.title)));
  }

  private async open(s: Session, entryId: string): Promise<EntryData> {
    const block = liveEntries(await this.blocksOf(s.vaultId)).find((b) => b.entryId === entryId);
    if (!block) throw new NotFoundException("Entrada não encontrada.");
    try {
      return openEntry(s.keys.enc, s.vaultId, entryId, block.seq, block.payload);
    } catch {
      throw new ConflictException("Não foi possível abrir esta entrada: o registro foi alterado ou está corrompido. Use a verificação de integridade.");
    }
  }

  async reveal(userId: string, entryId: string): Promise<EntryData> {
    const d = await this.open(this.session(userId), entryId);
    this.logger.log(`[AUDIT] vault_reveal user=${userId} entry=${entryId}`);
    return d;
  }

  private async append(s: Session, op: BlockOp, entryId: string, data?: EntryData): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const v = await tx.vault.findFirst({ where: { id: s.vaultId } });
      if (!v) throw new NotFoundException("Cofre não encontrado.");
      const seq = v.seq + 1;
      const prevHash = v.headHash || GENESIS;
      const payload = op === "put" ? sealEntry(s.keys.enc, s.vaultId, entryId, seq, data!) : "";
      const payloadHash = sha256(payload);
      const hash = blockHash(s.keys.mac, { vaultId: s.vaultId, seq, prevHash, op, entryId, payloadHash });
      // Cópia para a consulta pelo WhatsApp (só se a entrada permite e já existe o código): cifrada com a chave do WhatsApp
      let waPayload = "";
      let waLabel = "";
      if (op === "put" && data!.whatsapp && v.waKeyMaster) {
        const kw = unwrapWaKeyMaster(s.keys.enc, v.waKeyMaster, s.vaultId);
        try {
          waPayload = sealEntryWa(kw, s.vaultId, entryId, seq, data!);
          waLabel = sealLabel(s.vaultId, entryId, seq, data!.title);
        } finally {
          wipe(kw);
        }
      }
      // Se outra gravação entrou no meio, a numeração mudou: recusa em vez de bifurcar a cadeia
      const moved = await tx.vault.updateMany({ where: { id: s.vaultId, seq: v.seq }, data: { seq, headHash: hash } });
      if (moved.count !== 1) throw new ConflictException("O cofre foi alterado ao mesmo tempo. Tente de novo.");
      await tx.vaultBlock.create({ data: { vaultId: s.vaultId, seq, prevHash, op, entryId, payload, payloadHash, waPayload, waLabel, hash } });
      // O conteúdo anterior da entrada deixa de existir; a cadeia mantém só o hash dele
      await tx.vaultBlock.updateMany({ where: { vaultId: s.vaultId, entryId, seq: { lt: seq } }, data: { payload: "", waPayload: "", waLabel: "" } });
      return seq;
    });
  }

  async save(userId: string, entryId: string | undefined, raw: unknown): Promise<{ id: string }> {
    const s = this.session(userId);
    const checked = checkEntry(raw);
    if (!checked.ok) throw new BadRequestException(checked.error);
    const live = liveEntries(await this.blocksOf(s.vaultId));
    if (entryId) {
      if (!live.some((b) => b.entryId === entryId)) throw new NotFoundException("Entrada não encontrada.");
    } else if (live.length >= LIMITS.entries) {
      throw new BadRequestException(`O cofre já tem ${LIMITS.entries} entradas.`);
    }
    const id = entryId ?? randomUUID();
    await this.append(s, "put", id, checked.data);
    this.logger.log(`[AUDIT] vault_${entryId ? "updated" : "created"}_entry user=${userId} entry=${id}`);
    return { id };
  }

  async remove(userId: string, entryId: string): Promise<void> {
    const s = this.session(userId);
    if (!liveEntries(await this.blocksOf(s.vaultId)).some((b) => b.entryId === entryId)) throw new NotFoundException("Entrada não encontrada.");
    await this.append(s, "delete", entryId);
    this.logger.log(`[AUDIT] vault_deleted_entry user=${userId} entry=${entryId}`);
  }

  // ─── Integridade e senha mestra ───────────────────────────────

  /** Confere a cadeia inteira e se cada entrada ainda abre. Só com o cofre desbloqueado (a assinatura usa a chave do cofre). */
  async verify(userId: string) {
    const s = this.session(userId);
    const vault = await prisma.vault.findFirst({ where: { id: s.vaultId } });
    if (!vault) throw new NotFoundException("Cofre não encontrado.");
    const blocks = await this.blocksOf(s.vaultId);
    const chain = verifyChain(s.keys.mac, s.vaultId, blocks, { seq: vault.seq, hash: vault.headHash });
    const unreadable = liveEntries(blocks).filter((b) => {
      try {
        openEntry(s.keys.enc, s.vaultId, b.entryId, b.seq, b.payload);
        return false;
      } catch {
        return true;
      }
    }).length;
    return { ok: chain.ok && unreadable === 0, blocks: chain.checked, problem: chain.problem, unreadable };
  }

  async changeMaster(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    const problem = masterPasswordProblem(newPassword);
    if (problem) throw new BadRequestException(problem);
    const vk = await this.unwrap(userId, vault, String(oldPassword ?? ""));
    const kdf = newKdf();
    const kek = await this.serial(() => deriveKek(newPassword, kdf));
    try {
      // Só a chave do cofre é recifrada: as entradas e a cadeia continuam valendo
      await prisma.vault.update({ where: { id: vault.id }, data: { kdf: kdf as any, wrappedKey: wrapVaultKey(kek, vk, vault.id) } });
    } finally {
      wipe(kek, vk);
    }
    this.destroy(userId);
    this.logger.log(`[AUDIT] vault_master_changed user=${userId}`);
  }

  // ─── Esqueci a senha mestra ───────────────────────────────────
  //
  // O link do e-mail prova que a conta é do dono; a chave de recuperação é o que abre a chave do cofre. Sem a chave, só
  // dá para recomeçar com um cofre vazio (as senhas antigas são destruídas, nunca expostas).

  private resetKey = (token: string) => `vaultreset:${hashResetToken(token)}`;
  private resetCurrent = (userId: string) => `vaultresetcur:${userId}`;

  /** Manda o link (válido por 30 min, uso único, só o hash fica guardado) para o e-mail cadastrado, pela conta Google do dono. */
  async requestReset(userId: string): Promise<{ sentTo: string; expiresMinutes: number }> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    if ((await this.state.incr(`vaultresetreq:${userId}`, 3600_000)) > 3) {
      throw new HttpException("Muitos pedidos de recuperação. Tente de novo em 1 hora.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const accounts: string[] = await this.google.listAccounts(vault.workspaceId);
    if (!user?.email) throw new BadRequestException("Seu usuário não tem e-mail cadastrado.");
    if (!accounts.length) throw new BadRequestException("Conecte uma conta Google em Canais para eu poder enviar o e-mail de recuperação.");

    // Só o link mais recente vale
    const previous = await this.state.get<string>(this.resetCurrent(userId));
    if (previous) await this.state.del(previous);
    const token = newResetToken();
    const key = this.resetKey(token);
    await this.state.set(key, { userId, fails: 0, exp: Date.now() + RESET_TTL_MS }, RESET_TTL_MS);
    await this.state.set(this.resetCurrent(userId), key, RESET_TTL_MS);

    const link = `${process.env.WEB_URL || "http://localhost:3000"}/dashboard/vault/reset?token=${token}`;
    try {
      await this.google.gmailSend(
        vault.workspaceId,
        user.email,
        "Redefinição da senha mestra do cofre",
        [
          "Olá!",
          "",
          "Alguém (provavelmente você) pediu para redefinir a senha mestra do seu cofre de senhas.",
          "",
          "Para continuar, abra o link abaixo (vale por 30 minutos, funciona uma vez e exige que você esteja logado no painel):",
          link,
          "",
          "Você vai precisar da CHAVE DE RECUPERAÇÃO que recebeu ao criar o cofre. Com ela, você define uma nova senha mestra e mantém todas as senhas guardadas.",
          "Sem a chave, só é possível recomeçar com um cofre vazio: as senhas antigas são apagadas.",
          "",
          "Se não foi você, ignore este e-mail. Nada muda, e ninguém abre o cofre sem a senha mestra ou a chave de recuperação.",
        ].join("\n"),
        accounts[0],
      );
    } catch (e: any) {
      await this.state.del(key);
      this.logger.warn(`Envio do e-mail de recuperação falhou (user=${userId}): ${String(e?.message ?? e).slice(0, 160)}`);
      throw new BadGatewayException("Não consegui enviar o e-mail agora. Tente de novo em instantes.");
    }
    this.logger.log(`[AUDIT] vault_reset_requested user=${userId}`);
    return { sentTo: maskEmail(user.email), expiresMinutes: RESET_TTL_MS / 60_000 };
  }

  /** Confere o link: existe, não expirou e é deste usuário. Mensagem única para não ajudar quem adivinha. */
  private async checkToken(userId: string, token: unknown): Promise<{ key: string; rec: { userId: string; fails: number; exp: number } }> {
    const bad = new BadRequestException("Link inválido ou expirado. Peça um novo em “Esqueci a senha mestra”.");
    if (!resetTokenShape(token)) throw bad;
    const key = this.resetKey(token);
    const rec = await this.state.get<{ userId: string; fails: number; exp: number }>(key);
    if (!rec || rec.userId !== userId || rec.exp <= Date.now()) throw bad;
    return { key, rec };
  }

  private async afterReset(userId: string, workspaceId: string, key: string, what: string) {
    await this.state.del(key);
    await this.state.del(this.resetCurrent(userId));
    await this.state.del(this.failKey(userId));
    this.destroy(userId);
    this.logger.log(`[AUDIT] vault_reset_done user=${userId} modo=${what}`);
    // Aviso ao dono: se não foi ele, precisa saber
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      const accounts: string[] = await this.google.listAccounts(workspaceId);
      if (user?.email && accounts.length) {
        await this.google.gmailSend(
          workspaceId,
          user.email,
          "A senha mestra do seu cofre foi redefinida",
          `A senha mestra do seu cofre foi redefinida agora (${what === "recovery" ? "com a chave de recuperação; as senhas foram mantidas" : "recomeçando com um cofre vazio"}).\n\nSe não foi você, entre no painel, troque a senha do seu login e avise o administrador.`,
          accounts[0],
        );
      }
    } catch (e: any) {
      this.logger.warn(`Aviso de redefinição não enviado: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }

  /** Nova senha mestra usando a chave de recuperação: as senhas guardadas continuam; a chave de recuperação é trocada. */
  async recoverWithKey(userId: string, token: string, recoveryKey: string, newPassword: string): Promise<{ recoveryKey: string }> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    const problem = masterPasswordProblem(newPassword);
    if (problem) throw new BadRequestException(problem);
    const { key, rec } = await this.checkToken(userId, token);
    if (!vault.recoveryWrapped) throw new BadRequestException("Este cofre não tem chave de recuperação. Use “recomeçar com cofre vazio”.");

    let vk: Buffer | null = null;
    const bytes = parseRecoveryKey(recoveryKey);
    if (bytes) {
      const kek = recoveryKek(bytes, vault.recoverySalt);
      try {
        vk = unwrapVaultKeyRecovery(kek, vault.recoveryWrapped, vault.id);
      } catch {
        vk = null;
      } finally {
        wipe(kek, bytes);
      }
    }
    if (!vk) {
      // Tentativas erradas gastam o link: depois de 5, é preciso pedir outro
      const fails = rec.fails + 1;
      if (fails >= MAX_FAILS) await this.state.del(key);
      else await this.state.set(key, { ...rec, fails }, Math.max(rec.exp - Date.now(), 1000));
      this.logger.warn(`[AUDIT] vault_bad_recovery_key user=${userId} tentativa=${fails}`);
      throw new UnauthorizedException(fails >= MAX_FAILS ? "Chave de recuperação incorreta. Este link foi invalidado: peça outro." : "Chave de recuperação incorreta.");
    }

    const kdf = newKdf();
    const kek = await this.serial(() => deriveKek(newPassword, kdf));
    try {
      const next = this.newRecovery(vk, vault.id);
      await prisma.vault.update({
        where: { id: vault.id },
        data: { kdf: kdf as any, wrappedKey: wrapVaultKey(kek, vk, vault.id), recoverySalt: next.recoverySalt, recoveryWrapped: next.recoveryWrapped },
      });
      await this.afterReset(userId, vault.workspaceId, key, "recovery");
      return { recoveryKey: next.text };
    } finally {
      wipe(kek, vk);
    }
  }

  /** Sem a chave de recuperação: destrói o cofre antigo e cria outro, vazio, com a nova senha mestra. Exige digitar APAGAR. */
  async resetEmpty(userId: string, token: string, confirm: string, newPassword: string): Promise<{ recoveryKey: string }> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    if (String(confirm ?? "").trim() !== "APAGAR") throw new BadRequestException("Para apagar o cofre antigo, digite APAGAR.");
    const problem = masterPasswordProblem(newPassword);
    if (problem) throw new BadRequestException(problem);
    const { key } = await this.checkToken(userId, token);

    const built = await this.build(newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.vaultBlock.deleteMany({ where: { vaultId: vault.id } });
      await tx.vault.deleteMany({ where: { id: vault.id } });
      await tx.vault.create({ data: { id: built.id, userId, workspaceId: vault.workspaceId, ...built.data } });
    });
    await this.afterReset(userId, vault.workspaceId, key, "empty");
    return { recoveryKey: built.recoveryKey };
  }

  /** Gera outra chave de recuperação (a anterior deixa de valer). Exige a senha mestra. */
  async regenerateRecoveryKey(userId: string, password: string): Promise<{ recoveryKey: string }> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    const vk = await this.unwrap(userId, vault, String(password ?? ""));
    try {
      const next = this.newRecovery(vk, vault.id);
      await prisma.vault.update({ where: { id: vault.id }, data: { recoverySalt: next.recoverySalt, recoveryWrapped: next.recoveryWrapped } });
      this.logger.log(`[AUDIT] vault_recovery_key_regenerated user=${userId}`);
      return { recoveryKey: next.text };
    } finally {
      wipe(vk);
    }
  }

  // ─── Código de 4 dígitos e consulta pelo WhatsApp ─────────────

  private closeWa(userId: string) {
    const w = this.waSessions.get(userId);
    if (!w) return;
    clearTimeout(w.timer);
    wipe(w.kw);
    this.waSessions.delete(userId);
  }

  private waLive(userId: string): WaSession | null {
    const w = this.waSessions.get(userId);
    if (!w) return null;
    if (w.until <= Date.now()) {
      this.closeWa(userId);
      return null;
    }
    return w;
  }

  /**
   * Define (ou troca) o código de 4 dígitos. Exige a senha mestra. Gera uma chave nova do WhatsApp e refaz as cópias das
   * entradas marcadas: a chave antiga, se tiver vazado junto com um código antigo, não abre mais nada.
   */
  async setPin(userId: string, password: string, pin: string): Promise<void> {
    const vault = await this.vaultOf(userId);
    if (!vault) throw new NotFoundException("Você ainda não criou o cofre.");
    const problem = pinProblem(pin);
    if (problem) throw new BadRequestException(problem);
    const vk = await this.unwrap(userId, vault, String(password ?? ""));
    const keys = subkeys(vk);
    wipe(vk);
    const kw = newWaKey();
    const salt = newPinSalt();
    const kek = await this.serial(() => pinKek(pin, salt));
    try {
      await prisma.vault.update({ where: { id: vault.id }, data: { waSalt: salt, waKeyPin: wrapWaKeyPin(kek, kw, vault.id), waKeyMaster: wrapWaKeyMaster(keys.enc, kw, vault.id) } });
      for (const b of liveEntries(await this.blocksOf(vault.id))) {
        let waPayload = "";
        let waLabel = "";
        try {
          const d = openEntry(keys.enc, vault.id, b.entryId, b.seq, b.payload);
          if (d.whatsapp) {
            waPayload = sealEntryWa(kw, vault.id, b.entryId, b.seq, d);
            waLabel = sealLabel(vault.id, b.entryId, b.seq, d.title);
          }
        } catch {
          waPayload = "";
          waLabel = "";
        }
        await prisma.vaultBlock.updateMany({ where: { vaultId: vault.id, seq: b.seq }, data: { waPayload, waLabel } });
      }
    } finally {
      wipe(kek, kw, keys.enc, keys.mac);
    }
    await this.state.del(this.waLockKey(userId));
    this.waFails.delete(userId);
    this.closeWa(userId);
    this.logger.log(`[AUDIT] vault_pin_set user=${userId}`);
  }

  /**
   * Confere o código digitado no WhatsApp. A tentativa é contada ANTES de qualquer espera, para várias tentativas
   * simultâneas não furarem o limite; ao 3º erro seguido o WhatsApp fica bloqueado até a senha mestra ser digitada no painel.
   */
  async whatsappOpen(userId: string, pin: string): Promise<{ ok: true } | { ok: false; reason: "none" | "no_pin" | "locked" | "wrong"; left?: number }> {
    const vault = await this.vaultOf(userId);
    if (!vault) return { ok: false, reason: "none" };
    if (!vault.waKeyPin) return { ok: false, reason: "no_pin" };
    if (await this.state.get(this.waLockKey(userId))) return { ok: false, reason: "locked" };
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return { ok: false, reason: "wrong", left: MAX_PIN_ATTEMPTS - (this.waFails.get(userId) ?? 0) };

    const attempt = (this.waFails.get(userId) ?? 0) + 1;
    this.waFails.set(userId, attempt);
    const lockNow = async () => {
      await this.state.set(this.waLockKey(userId), 1);
      this.closeWa(userId);
      this.logger.warn(`[AUDIT] vault_whatsapp_locked user=${userId}`);
      return { ok: false as const, reason: "locked" as const };
    };
    if (attempt > MAX_PIN_ATTEMPTS) return lockNow();

    let kw: Buffer | null = null;
    const kek = await this.serial(() => pinKek(pin, vault.waSalt));
    try {
      kw = unwrapWaKeyPin(kek, vault.waKeyPin, vault.id);
    } catch {
      kw = null;
    } finally {
      wipe(kek);
    }
    if (!kw) {
      this.logger.warn(`[AUDIT] vault_bad_pin user=${userId} tentativa=${attempt}`);
      return attempt >= MAX_PIN_ATTEMPTS ? lockNow() : { ok: false, reason: "wrong", left: MAX_PIN_ATTEMPTS - attempt };
    }
    this.waFails.delete(userId);
    this.closeWa(userId);
    const timer = setTimeout(() => this.closeWa(userId), WA_WINDOW_MS);
    timer.unref?.();
    this.waSessions.set(userId, { kw, vaultId: vault.id, until: Date.now() + WA_WINDOW_MS, timer });
    await this.indexLabels(vault.id, kw);
    this.logger.log(`[AUDIT] vault_whatsapp_open user=${userId}`);
    return { ok: true };
  }

  /** Entradas do WhatsApp criadas antes do índice de títulos ganham o rótulo na primeira vez que o código abre a janela. */
  private async indexLabels(vaultId: string, kw: Buffer) {
    try {
      for (const b of liveEntries(await this.blocksOf(vaultId))) {
        if (!b.waPayload || b.waLabel) continue;
        const d = openEntryWa(kw, vaultId, b.entryId, b.seq, b.waPayload);
        await prisma.vaultBlock.update({ where: { id: b.id }, data: { waLabel: sealLabel(vaultId, b.entryId, b.seq, d.title) } });
      }
    } catch (e: any) {
      this.logger.warn(`Cofre: índice de títulos não atualizado: ${e.message}`);
    }
  }

  /**
   * Nomes das entradas liberadas para o WhatsApp, SEM pedir o código (o código só é pedido para mostrar a senha).
   * `unindexed` = entradas antigas ainda sem título no índice: aparecem depois da primeira digitação do código.
   */
  async whatsappList(userId: string): Promise<{ state: "none" | "no_pin" | "locked" | "ok"; items: { id: string; title: string }[]; unindexed: number }> {
    const vault = await this.vaultOf(userId);
    if (!vault) return { state: "none", items: [], unindexed: 0 };
    if (!vault.waKeyPin) return { state: "no_pin", items: [], unindexed: 0 };
    if (await this.state.get(this.waLockKey(userId))) return { state: "locked", items: [], unindexed: 0 };
    const items: { id: string; title: string }[] = [];
    let unindexed = 0;
    for (const b of liveEntries(await this.blocksOf(vault.id))) {
      if (!b.waPayload) continue;
      try {
        if (!b.waLabel) throw new Error("sem título");
        items.push({ id: b.entryId, title: openLabel(vault.id, b.entryId, b.seq, b.waLabel) });
      } catch {
        unindexed++;
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    return { state: "ok", items, unindexed };
  }

  /** Cópias do WhatsApp abertas com a chave da janela atual. */
  private async waEntries(w: WaSession) {
    const out: (EntryData & { id: string })[] = [];
    for (const b of liveEntries(await this.blocksOf(w.vaultId))) {
      if (!b.waPayload) continue;
      try {
        out.push({ id: b.entryId, ...openEntryWa(w.kw, w.vaultId, b.entryId, b.seq, b.waPayload) });
      } catch {
        // cópia alterada: ignorada (a entrada continua no painel)
      }
    }
    return out;
  }

  /** Busca entre as entradas do WhatsApp; devolve nomes, nunca senhas. Sem o código digitado antes: pin_required. */
  async whatsappLookup(userId: string, query: string): Promise<{ state: "none" | "no_pin" | "locked" | "pin_required" | "ok"; matches: { id: string; title: string; username: string; url: string }[] }> {
    const vault = await this.vaultOf(userId);
    if (!vault) return { state: "none", matches: [] };
    if (!vault.waKeyPin) return { state: "no_pin", matches: [] };
    if (await this.state.get(this.waLockKey(userId))) return { state: "locked", matches: [] };
    const w = this.waLive(userId);
    if (!w) return { state: "pin_required", matches: [] };
    const all = await this.waEntries(w);
    return { state: "ok", matches: matchEntries(all, query).map((e) => ({ id: e.id, title: e.title, username: e.username, url: e.url })) };
  }

  /** Mostra a senha e GASTA o código: a próxima consulta pede o código de novo. */
  async whatsappReveal(userId: string, entryId: string): Promise<EntryData | "pin_required" | null> {
    const w = this.waLive(userId);
    if (!w) return "pin_required";
    const entry = (await this.waEntries(w)).find((e) => e.id === entryId);
    this.closeWa(userId);
    if (!entry) return null;
    const { id: _id, ...data } = entry;
    this.logger.log(`[AUDIT] vault_reveal_whatsapp user=${userId} entry=${entryId}`);
    return data;
  }
}
