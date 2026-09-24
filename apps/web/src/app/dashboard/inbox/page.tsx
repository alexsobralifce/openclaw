import { ConversationList } from "@/components/inbox/ConversationList";
import { EmptyConversation } from "@/components/inbox/EmptyConversation";

export default function InboxPage() {
  return (
    <div className="flex h-full">
      <ConversationList />
      <EmptyConversation />
    </div>
  );
}
