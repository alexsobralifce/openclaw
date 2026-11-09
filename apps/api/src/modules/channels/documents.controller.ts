import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Request, Res } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import { Access } from "../auth/access";
import { AssistantService, MAX_MEDIA_BYTES } from "./assistant/assistant.service";
import { commanderForUser } from "./assistant/commander";
import { GoogleService } from "../integrations/google/google.service";
import { StateService } from "../state/state.service";
import { allCategories, createCategory, deleteCategory, moveDocumentFile, ORGANIZE_BATCH, organizeDocumentsBatch } from "./assistant/document-categories";
import { cleanTag, docsInCategory, MAX_TAGS, NO_CATEGORY, searchDocs, topTags } from "./assistant/documents";
import { deleteDocument, getDocument, listDocuments, updateDocument } from "./assistant/documents-store";

class UploadDocumentDto {
  @IsString()
  base64!: string;

  @IsString() @MaxLength(100)
  mime!: string;

  @IsOptional() @IsString() @MaxLength(40)
  category?: string;
}

class CategoryDto {
  @IsString() @MaxLength(40)
  name!: string;
}

class UpdateDocumentDto {
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_TAGS) @IsString({ each: true }) @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional() @IsString() @MaxLength(120)
  title?: string;

  @IsOptional() @IsString() @MaxLength(60)
  topic?: string;
}

/** O que o painel vê de um documento: sem o id do arquivo no Drive nem a conta (o download passa pela API). */
const view = (d: any) => ({
  id: d.id,
  kind: d.kind,
  title: d.title,
  topic: d.topic,
  tags: d.tags,
  summary: d.summary,
  mime: d.mime,
  sizeBytes: d.sizeBytes,
  pages: d.pages,
  origin: d.origin,
  createdAt: d.createdAt,
});

/** Biblioteca de documentos (PDFs catalogados com tags) no painel. Tudo filtrado pelo workspace do usuário. */
@Access("drive")
@Controller("documents")
export class DocumentsController {
  constructor(private google: GoogleService, private state: StateService, private assistant: AssistantService) {}

  private ws = (req: any): string => req.user.workspaces[0]?.workspaceId;

  /** Lista com busca (`q`: tag, título, assunto ou resumo) e filtros por tag (`tag`) e categoria (`category`); devolve também as tags e as categorias com a contagem. */
  @Get()
  async list(@Request() req: any, @Query("q") q?: string, @Query("tag") tag?: string, @Query("category") category?: string) {
    const ws = this.ws(req);
    const all = await listDocuments(ws);
    // a busca não chama IA: pontua tag, título, assunto e resumo (searchDocs)
    let docs = q?.trim() ? searchDocs(all, q.slice(0, 80)) : all;
    const t = cleanTag(tag);
    if (t) docs = docs.filter((d) => d.tags.includes(t));
    if (category?.trim()) {
      const inCat = new Set(docsInCategory(docs, category.slice(0, 60)).map((d) => d.id));
      docs = docs.filter((d) => inCat.has(d.id));
    }
    const documents = docs.map((d) => view(d));
    return { documents, tags: topTags(all, 50), categories: await allCategories(this.state, ws, all), total: all.length };
  }

  /** Guarda um PDF novo no Drive e no catálogo. Com `category`, vale a escolhida (nova ou existente); sem ela, a IA sugere. */
  @Post()
  async upload(@Request() req: any, @Body() body: UploadDocumentDto) {
    const c = await commanderForUser(req.user.id);
    if (!c) throw new ForbiddenException("Conta sem acesso ao assistente.");
    if (!/^application\/pdf$/i.test(body.mime)) throw new BadRequestException("Envie um arquivo PDF.");
    if (!body.base64.length) throw new BadRequestException("Arquivo vazio.");
    if (body.base64.length * 0.75 > MAX_MEDIA_BYTES) throw new BadRequestException("Arquivo grande demais (limite de 15 MB).");
    const r = await this.assistant.storeDocumentFromPanel(c, { base64: body.base64, mime: "application/pdf" }, body.category);
    if (!r.ok) throw new BadRequestException(r.message.slice(0, 300));
    return view(r.row);
  }

  /** Cria uma categoria (pode ficar vazia). Devolve a lista de categorias atualizada. */
  @Post("categories")
  async createCat(@Request() req: any, @Body() body: CategoryDto) {
    const ws = this.ws(req);
    const r = await createCategory(this.state, ws, body.name);
    if (!r.ok) {
      const msg = { short: "Dê um nome com pelo menos 2 letras.", fixed: `"${NO_CATEGORY}" já existe: é onde ficam os documentos de categorias apagadas.`, exists: `A categoria "${r.name ?? body.name}" já existe.`, limit: "Limite de categorias criadas atingido. Apague alguma antes." }[r.reason];
      throw new BadRequestException(msg);
    }
    return { name: r.name, categories: await allCategories(this.state, ws) };
  }

  /** Apaga a categoria; os documentos dela vão para "Sem categoria" (nenhum documento é apagado). */
  @Delete("categories")
  async removeCat(@Request() req: any, @Query("name") name?: string) {
    const ws = this.ws(req);
    const r = await deleteCategory(this.state, ws, String(name ?? "").slice(0, 60));
    if (!r.ok) {
      if (r.reason === "fixed") throw new BadRequestException(`"${NO_CATEGORY}" não pode ser apagada.`);
      throw new NotFoundException("Categoria não encontrada.");
    }
    // a pasta da categoria apagada fica no Drive; só os PDFs que estavam nela vão para "Sem categoria", até ORGANIZE_BATCH por chamada.
    // Notas antigas (sem arquivo no Drive) são filtradas antes do corte, para não ocupar a vaga dos PDFs.
    const pdfs = r.docs.filter((d) => d.kind === "pdf");
    const lote = pdfs.slice(0, ORGANIZE_BATCH);
    const folders = new Map<string, string>();
    for (const d of lote) await moveDocumentFile(this.google, ws, d, NO_CATEGORY, folders);
    return { moved: r.moved, pendentes: pdfs.length - lote.length, categories: await allCategories(this.state, ws) };
  }

  @Patch(":id")
  async update(@Request() req: any, @Param("id") id: string, @Body() body: UpdateDocumentDto) {
    const ws = this.ws(req);
    const before = await getDocument(ws, id);
    const d = await updateDocument(ws, id, { title: body.title, topic: body.topic, tags: body.tags });
    if (!d) throw new NotFoundException("Documento não encontrado.");
    // banco primeiro; se a categoria mudou, o PDF acompanha (falha do Drive não desfaz a ficha)
    if (before && d.topic !== before.topic) await moveDocumentFile(this.google, ws, d, d.topic);
    return view(d);
  }

  /** Organiza os PDFs nas pastas das categorias, até 50 mudanças por chamada. Chame de novo enquanto `unchecked` for maior que zero. Só por pedido. */
  @Post("organize")
  async organize(@Request() req: any) {
    return organizeDocumentsBatch(this.google, this.state, this.ws(req));
  }

  /** Apaga: o PDF vai para a lixeira do Drive (30 dias) e a ficha sai. Ficha de nota antiga só sai do catálogo. */
  @Delete(":id")
  async remove(@Request() req: any, @Param("id") id: string) {
    const ws = this.ws(req);
    const d = await getDocument(ws, id);
    if (!d) throw new NotFoundException("Documento não encontrado.");
    if (d.kind === "pdf") {
      try {
        await this.google.documentTrash(ws, d.driveFileId, d.account);
      } catch (e: any) {
        // Arquivo que já não está na pasta (apagado ou movido por fora): a ficha órfã pode sair
        if (!/não está na sua pasta/.test(String(e?.message))) throw new BadRequestException(String(e?.message ?? "Não consegui apagar o arquivo.").slice(0, 200));
      }
    }
    await deleteDocument(ws, id);
    return { ok: true };
  }

  /** Baixa o arquivo na hora, direto do Drive do dono (nada fica guardado no servidor). */
  @Get(":id/download")
  async download(@Request() req: any, @Param("id") id: string, @Res() res: any) {
    const ws = this.ws(req);
    const d = await getDocument(ws, id);
    if (!d) throw new NotFoundException("Documento não encontrado.");
    let f: Awaited<ReturnType<GoogleService["driveFile"]>>;
    try {
      f = await this.google.driveFile(ws, d.driveFileId, d.account);
    } catch (e: any) {
      throw new NotFoundException(String(e?.message ?? "Não consegui abrir o arquivo no Drive.").slice(0, 200));
    }
    if (!f.base64) return res.status(422).json({ message: `Não consegui baixar ${f.nome}: ${f.motivo ?? "arquivo grande demais"}.`, link: f.link ?? null });
    res.set({ "Content-Type": f.mime || "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.nome)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
    res.send(Buffer.from(f.base64, "base64"));
  }
}
