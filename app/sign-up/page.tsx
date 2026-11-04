import { SignUp } from "@clerk/nextjs";

// Hash routing keeps Clerk's multi-step flow on this single route, so no catch-all segment is needed.
export default function SignUpPage() { return <main className="auth-page"><SignUp routing="hash" /></main>; }
