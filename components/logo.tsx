import Link from "next/link";
import { Repeat2 } from "lucide-react";
import type { Route } from "next";

export function Logo({ href = "/" }: { href?: Route }) {
  return (
    <Link className="logo" href={href} aria-label="LendLoop home">
      <span className="logo-mark"><Repeat2 size={20} strokeWidth={2.3} /></span>
      <span>LendLoop</span>
    </Link>
  );
}
