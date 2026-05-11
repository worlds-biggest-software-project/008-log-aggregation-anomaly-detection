import { redirect } from "next/navigation";

/**
 * Root page: redirects authenticated users to the log explorer.
 * NextAuth middleware handles unauthenticated redirects to /login.
 */
export default function RootPage() {
  redirect("/logs");
}
