import { MembersDirectoryPage as SharedMembersDirectoryPage } from "@quickwork/views/members";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function MembersDirectoryPage() {
  useDocumentTitle("Members");
  return <SharedMembersDirectoryPage />;
}
