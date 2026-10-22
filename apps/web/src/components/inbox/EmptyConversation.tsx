export function EmptyConversation() {
  return (
    <div className="hidden md:flex flex-1 items-center justify-center bg-gray-950">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto mb-4">
          <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#4B5563" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-500">Selecione uma conversa</p>
        <p className="text-xs text-gray-600 mt-1">Escolha uma conversa para começar</p>
      </div>
    </div>
  );
}
