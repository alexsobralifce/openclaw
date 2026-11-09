import { Injectable } from "@nestjs/common";
import { prisma } from "@magobox/database";

@Injectable()
export class ContactsService {
  list(workspaceId: string, search?: string) {
    return prisma.contact.findMany({
      where: {
        workspaceId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      include: { tags: { include: { tag: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  get(workspaceId: string, id: string) {
    return prisma.contact.findFirstOrThrow({
      where: { id, workspaceId },
      include: {
        tags: { include: { tag: true } },
        conversations: { orderBy: { updatedAt: "desc" }, take: 5 },
      },
    });
  }

  create(workspaceId: string, data: { name: string; email?: string; phone?: string }) {
    return prisma.contact.create({ data: { workspaceId, ...data } });
  }

  update(workspaceId: string, id: string, data: Partial<{ name: string; email: string; phone: string; notes: string }>) {
    return prisma.contact.updateMany({ where: { id, workspaceId }, data });
  }
}
