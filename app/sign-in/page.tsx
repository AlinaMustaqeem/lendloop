import { SignIn } from "@clerk/nextjs";

// Hash routing keeps Clerk's multi-step flow on this single route, so no catch-all segment is needed.
export default function SignInPage() { return <main className="auth-page"><SignIn routing="hash" /></main>; }
