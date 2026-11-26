import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const sp = await searchParams;
  return <LoginForm notice={sp.deleted ? "Your account and all its data were deleted." : undefined} />;
}
