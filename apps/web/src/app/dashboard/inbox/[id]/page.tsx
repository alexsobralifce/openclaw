import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationPanel } from "@/components/inbox/ConversationPanel";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex h-full">
      <ConversationList activeId={id} hideOnMobile />
      <ConversationPanel conversationId={id} />
    </div>
  );
}
