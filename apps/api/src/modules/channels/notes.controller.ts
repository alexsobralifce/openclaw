import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Request } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";
import { Access } from "../auth/access";
import { cleanNoteTitle, MAX_ITEMS, sanitizeItems } from "./assistant/list-notes";
import { createNote, deleteNote, listNotes, ListNoteRow, updateNote } from "./assistant/list-notes-store";

class NoteDto {
  @IsOptional() @IsString() @MaxLength(60)
  title?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ITEMS)
  items?: { text?: string; done?: boolean }[];

  /** Data e hora do lembrete (ISO); null tira o lembrete. */
  @IsOptional() @IsString() @MaxLength(40)
  remindAt?: string | null;
}

const view = (n: ListNoteRow) => ({ id: n.id, title: n.title, items: n.items, remindAt: n.remindAt, remindedAt: n.remindedAt, createdAt: n.createdAt, updatedAt: n.updatedAt });

/** Notas em lista com lembrete (as mesmas do menu do assistente). Tudo filtrado pelo workspace do usuário. */
@Access("assistant")
@Controller("notes")
export class NotesController {
  private ws = (req: any): string => req.user.workspaces[0]?.workspaceId;

  /** Lembrete: data válida e no futuro (o painel manda o horário em ISO). */
  private remind(raw: string | null | undefined): Date | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null || raw === "") return null;
    const at = new Date(raw);
    if (isNaN(at.getTime())) throw new BadRequestException("Data do lembrete inválida.");
    if (at.getTime() <= Date.now()) throw new BadRequestException("O lembrete precisa ser em um horário futuro.");
    return at;
  }

  @Get()
  async list(@Request() req: any) {
    return { notes: (await listNotes(this.ws(req))).map(view) };
  }

  @Post()
  async create(@Request() req: any, @Body() body: NoteDto) {
    const title = cleanNoteTitle(body.title);
    if (title.length < 2) throw new BadRequestException("Dê um título à nota (pelo menos 2 letras).");
    const remindAt = this.remind(body.remindAt);
    const ws = this.ws(req);
    const made = await createNote(ws, title, sanitizeItems(body.items ?? []));
    const note = remindAt ? ((await updateNote(ws, made.id, { remindAt })) ?? made) : made;
    return view(note);
  }

  @Patch(":id")
  async update(@Request() req: any, @Param("id") id: string, @Body() body: NoteDto) {
    const patch: { title?: string; items?: ReturnType<typeof sanitizeItems>; remindAt?: Date | null } = {};
    if (body.title !== undefined) {
      const title = cleanNoteTitle(body.title);
      if (title.length < 2) throw new BadRequestException("O título precisa ter pelo menos 2 letras.");
      patch.title = title;
    }
    if (body.items !== undefined) patch.items = sanitizeItems(body.items);
    const remindAt = this.remind(body.remindAt);
    if (remindAt !== undefined) patch.remindAt = remindAt;
    const n = await updateNote(this.ws(req), id, patch);
    if (!n) throw new NotFoundException("Nota não encontrada.");
    return view(n);
  }

  @Delete(":id")
  async remove(@Request() req: any, @Param("id") id: string) {
    if (!(await deleteNote(this.ws(req), id))) throw new NotFoundException("Nota não encontrada.");
    return { ok: true };
  }
}
