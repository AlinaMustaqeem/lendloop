import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowRight, HandHeart, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/logo";
import { PublicCatalog } from "@/components/public-catalog";

export default function HomePage() {
  return (
    <main>
      <header className="site-header shell">
        <Logo />
        <nav className="header-actions" aria-label="Account navigation">
          <Show when="signed-out">
            <SignInButton mode="modal"><button className="button button-ghost">Sign in</button></SignInButton>
            <SignInButton mode="modal"><button className="button button-primary">Lend or borrow <ArrowRight size={17} /></button></SignInButton>
          </Show>
          <Show when="signed-in">
            <Link className="button button-primary" href="/dashboard">Open dashboard <ArrowRight size={17} /></Link>
            <UserButton />
          </Show>
        </nav>
      </header>

      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow"><Sparkles size={15} /> Share more. Buy less.</p>
          <h1>Borrow what you need.<br /><span>Lend what you don’t.</span></h1>
          <p className="hero-text">The friendly way for neighbors to share tools, save money, and make useful things useful again.</p>
          <Show when="signed-out">
            <SignInButton mode="modal"><button className="button button-primary button-large">Sign in to lend or borrow <ArrowRight size={19} /></button></SignInButton>
          </Show>
          <Show when="signed-in">
            <Link className="button button-primary button-large" href="/dashboard">Browse all tools <ArrowRight size={19} /></Link>
          </Show>
          <div className="trust-line"><ShieldCheck size={17} /> Private owner details · Secure neighborhood sharing</div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="visual-card visual-card-main">
            <span className="visual-kicker">JUST LISTED NEARBY</span>
            <div className="visual-emoji">🪚</div>
            <div><strong>Circular saw</strong><span>Power tools</span></div>
            <small><i /> Available now</small>
          </div>
          <div className="visual-card visual-card-float"><HandHeart /><div><strong>Neighbor powered</strong><span>Good tools deserve more than one job.</span></div></div>
          <span className="orbit orbit-one" /><span className="orbit orbit-two" />
        </div>
      </section>

      <div className="shell"><PublicCatalog /></div>

      <section className="how-section shell">
        <p className="eyebrow">How it works</p>
        <div className="steps">
          <div><span>01</span><h3>List it</h3><p>Add a tool you’re happy to share.</p></div>
          <div><span>02</span><h3>Request it</h3><p>Choose the dates that work for you.</p></div>
          <div><span>03</span><h3>Pass it on</h3><p>Approve, borrow, return. We handle the reminders.</p></div>
        </div>
      </section>

      <footer className="site-footer shell"><Logo /><p>Built for better neighborhoods.</p></footer>
    </main>
  );
}
