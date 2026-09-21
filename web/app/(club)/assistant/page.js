"use client";

import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import AssistantView from "@/components/AssistantView";
import { useSession } from "@/lib/session";

export default function AssistantPage() {
  const { club } = useSession();

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask questions about your records in the active club."
        action={<MessageCircle size={20} className="text-accent-600" aria-hidden />}
      />
      <AssistantView clubId={club?.clubId} />
    </>
  );
}
