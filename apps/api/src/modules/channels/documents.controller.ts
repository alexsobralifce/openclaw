import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Query, Request, Res } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import { Access } from "../auth/access";
import { GoogleService } from "../integrations/google/google.service";
import { cleanTag, docsInCategory, MAX_TAGS, searchDocs, topCategories, topTags } from "./assistant/documents";
import { deleteDocument, getDocument, listDocuments, updateDocument } from "./assistant/documents-store";

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
  constructor(private google: GoogleService) {}

  private ws = (req: any): string => req.user.workspaces[0]?.workspaceId;

  /** Lista com busca (`q`: tag, título, assunto ou resumo) e filtros por tag (`tag`) e categoria (`category`); devolve também as tags e as categorias com a contagem. */
  @Get()
  async list(@Request() req: any, @Query("q") q?: string, @Query("tag") tag?: string, @Query("category") category?: string) {
    const all = await listDocuments(this.ws(req));
    let docs = q?.trim() ? searchDocs(all, q.slice(0, 80)) : all;
    const t = cleanTag(tag);
    if (t) docs = docs.filter((d) => d.tags.includes(t));
    if (category?.trim()) {
      const inCat = new Set(docsInCategory(docs, category.slice(0, 60)).map((d) => d.id));
      docs = docs.filter((d) => inCat.has(d.id));
    }
    return { documents: docs.map(view), tags: topTags(all, 50), categories: topCategories(all), total: all.length };
  }

  @Patch(":id")
  async update(@Request() req: any, @Param("id") id: string, @Body() body: UpdateDocumentDto) {
    const d = await updateDocument(this.ws(req), id, { title: body.title, topic: body.topic, tags: body.tags });
    if (!d) throw new NotFoundException("Documento não encontrado.");
    return view(d);
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
