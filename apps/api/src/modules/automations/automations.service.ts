import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@openclaw/database";
import { isRuleError, validateRule } from "./rules";

@Injectable()
export class AutomationsService {
  list(workspaceId: string) {
    return prisma.automation.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  }

  create(workspaceId: string, name: string, trigger: unknown, actions: unknown) {
    const rule = this.validate(trigger, actions);
    return prisma.automation.create({ data: { workspaceId, name, trigger: rule.trigger as any, actions: rule.actions as any } });
  }

  async update(workspaceId: string, id: string, data: { name?: string; trigger?: unknown; actions?: unknown }) {
    const current = await this.find(workspaceId, id);
    const rule = this.validate(data.trigger ?? current.trigger, data.actions ?? current.actions);
    return prisma.automation.update({
      where: { id },
      data: { ...(data.name ? { name: data.name } : {}), trigger: rule.trigger as any, actions: rule.actions as any },
    });
  }

  async toggle(workspaceId: string, id: string, isActive: boolean) {
    await this.find(workspaceId, id);
    return prisma.automation.update({ where: { id }, data: { isActive } });
  }

  async remove(workspaceId: string, id: string) {
    await this.find(workspaceId, id);
    await prisma.automation.delete({ where: { id } });
    return { ok: true };
  }

  private async find(workspaceId: string, id: string) {
    const a = await prisma.automation.findFirst({ where: { id, workspaceId } });
    if (!a) throw new NotFoundException("Automação não encontrada");
    return a;
  }

  private validate(trigger: unknown, actions: unknown) {
    try {
      return validateRule(trigger, actions);
    } catch (e) {
      if (isRuleError(e)) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
