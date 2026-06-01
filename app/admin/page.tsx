import { AdminPageClient } from "./AdminPageClient";
import { getAdminWallet } from "@/lib/server/adminAuth";

export default function AdminPage() {
  return <AdminPageClient adminWallet={getAdminWallet()} />;
}
