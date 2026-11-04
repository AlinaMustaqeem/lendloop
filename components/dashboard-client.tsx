"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/logo";
import { TOOL_CATEGORIES, TOOL_CONDITIONS, formatCategory, formatDate } from "@/lib/constants";
import {
  BadgeCheck,
  BellRing,
  CalendarDays,
  Check,
  PackageOpen,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type Tool = {
  _id: string;
  ownerId: string;
  name: string;
  category: string;
  condition: "like-new" | "good" | "fair";
  description: string;
  isArchived: boolean;
  available: boolean;
  ownerName: string;
  trustedLender: boolean;
};
type RequestRow = {
  _id: string;
  toolName: string;
  borrowerName: string;
  lenderName: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "declined" | "cancelled";
};
type Loan = {
  _id: string;
  toolName: string;
  borrowerName: string;
  lenderName: string;
  startDate: string;
  dueDate: string;
  status: "active" | "returned";
};
type User = {
  _id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  isTrustedLender: boolean;
};
type Tab = "browse" | "listings" | "requests" | "incoming" | "loans" | "admin";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.replace(/^.*Uncaught ConvexError:\s*/, "");
  return "Something went wrong. Please try again.";
}

function Modal({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        {children}
      </section>
    </div>
  );
}

function ToolForm({ tool, onClose, onSaved }: { tool?: Tool; onClose: () => void; onSaved: (message: string) => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const values = {
      name: String(data.get("name")), category: String(data.get("category")),
      condition: String(data.get("condition")), description: String(data.get("description")),
    };
    try {
      if (tool) await update({ toolId: tool._id, ...values }); else await create(values);
      onSaved(tool ? "Listing updated" : "Tool listed for your neighbors"); onClose();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  return (
    <Modal title={tool ? "Edit listing" : "List a tool"} subtitle="A few useful details help neighbors borrow with confidence." onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="field full"><label htmlFor="tool-name">Tool name</label><input id="tool-name" name="name" maxLength={80} required defaultValue={tool?.name} placeholder="e.g. Cordless drill" /></div>
        <div className="field"><label htmlFor="category">Category</label><select id="category" name="category" required defaultValue={tool?.category ?? "power tools"}>{TOOL_CATEGORIES.map((item) => <option key={item} value={item}>{formatCategory(item)}</option>)}</select></div>
        <div className="field"><label htmlFor="condition">Condition</label><select id="condition" name="condition" required defaultValue={tool?.condition ?? "good"}>{TOOL_CONDITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div className="field full"><label htmlFor="description">Short description</label><textarea id="description" name="description" maxLength={500} required defaultValue={tool?.description} placeholder="What should a borrower know?" /></div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions field full"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : tool ? "Save changes" : "List tool"}</button></div>
      </form>
    </Modal>
  );
}

function BorrowForm({ tool, onClose, onSaved }: { tool: Tool; onClose: () => void; onSaved: (message: string) => void }) {
  const create = useMutation(api.requests.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await create({ toolId: tool._id, startDate: String(data.get("startDate")), endDate: String(data.get("endDate")), note: String(data.get("note") || "") });
      onSaved("Request sent to the lender"); onClose();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Borrow ${tool.name}`} subtitle={`From ${tool.ownerName}. Pick the dates that work for you.`} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="field"><label htmlFor="start-date">From</label><input id="start-date" name="startDate" type="date" min={today} required /></div>
        <div className="field"><label htmlFor="end-date">Until</label><input id="end-date" name="endDate" type="date" min={today} required /></div>
        <div className="field full"><label htmlFor="note">Note to lender (optional)</label><textarea id="note" name="note" maxLength={300} placeholder="Tell them what you need it for or suggest a pickup time." /></div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions field full"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button></div>
      </form>
    </Modal>
  );
}

type LoanActivity = { _id: string; type: string; status: "pending" | "delivered" | "failed"; updatedAt: number };

const ACTIVITY_NAMES: Record<string, string> = {
  "request.approved": "Approval notice",
  "reminder.overdue": "Overdue reminder",
};

function activityLabel(event: LoanActivity) {
  const name = ACTIVITY_NAMES[event.type] ?? "Notification";
  if (event.status === "delivered") return `${name} sent`;
  if (event.status === "failed") return `${name} failed`;
  return `${name} queued`;
}

function relativeTime(timestamp: number, now: number) {
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const minutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><PackageOpen /><h3>{title}</h3><p>{body}</p></div>;
}

function LoanRow({ loan, notify }: { loan: Loan; notify: (message: string) => void }) {
  const markReturned = useMutation(api.loans.markReturned);
  const [renderedAt] = useState(() => Date.now());
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const activity = useQuery(api.automations.recentForLoan, { loanId: loan._id }) as LoanActivity[] | undefined;
  async function complete() {
    try { await markReturned({ loanId: loan._id }); notify("Loan marked as returned"); } catch (caught) { notify(errorMessage(caught)); }
  }
  return (
    <div className="request-row">
      <div><strong>{loan.toolName}</strong><small>{loan.borrowerName} borrowing from {loan.lenderName}</small></div>
      <div><span>{formatDate(loan.startDate)} – {formatDate(loan.dueDate)}</span><small>{loan.status === "active" && loan.dueDate < today ? "Overdue" : "Loan period"}</small></div>
      <div><span className={`status status-${loan.status}`}>{loan.status}</span></div>
      <div className="request-actions">{loan.status === "active" && <button className="button button-secondary button-small" onClick={complete}><Check size={14} /> Mark returned</button>}</div>
      {activity && activity.length > 0 && (
        <ul className="loan-activity" aria-label="Recent automation activity">
          {activity.slice(0, 3).map((event) => (
            <li key={event._id} className={event.status === "failed" ? "failed" : undefined}>
              <BellRing size={12} aria-hidden="true" /> {activityLabel(event)} {relativeTime(event.updatedAt, renderedAt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DashboardClient() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const [synced, setSynced] = useState(false);
  const [tab, setTab] = useState<Tab>("browse");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [toolModal, setToolModal] = useState<Tool | "new" | null>(null);
  const [borrowTool, setBorrowTool] = useState<Tool | null>(null);
  const [toast, setToast] = useState("");
  const removeTool = useMutation(api.tools.remove);
  const adminRemoveTool = useMutation(api.tools.adminRemove);
  const decide = useMutation(api.requests.decide);
  const cancel = useMutation(api.requests.cancel);
  const setTrusted = useMutation(api.users.setTrustedLender);

  useEffect(() => {
    if (isAuthenticated && !synced) ensureCurrent({}).then(() => setSynced(true));
  }, [ensureCurrent, isAuthenticated, synced]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(timer); }, [toast]);

  const me = useQuery(api.users.me, synced ? {} : "skip") as User | null | undefined;
  const tools = useQuery(api.tools.listAll, synced ? {} : "skip") as Tool[] | undefined;
  const myListings = useQuery(api.tools.myListings, synced ? {} : "skip") as Tool[] | undefined;
  const myRequests = useQuery(api.requests.mine, synced ? {} : "skip") as RequestRow[] | undefined;
  const incoming = useQuery(api.requests.incoming, synced ? {} : "skip") as RequestRow[] | undefined;
  const loans = useQuery(api.loans.mine, synced ? {} : "skip") as Loan[] | undefined;
  const adminUsers = useQuery(api.users.list, synced && me?.role === "admin" ? {} : "skip") as User[] | undefined;
  const adminLoans = useQuery(api.loans.all, synced && me?.role === "admin" ? {} : "skip") as Loan[] | undefined;

  const filteredTools = useMemo(() => (tools ?? []).filter((tool) =>
    (!category || tool.category === category) &&
    (!search || `${tool.name} ${tool.description}`.toLowerCase().includes(search.toLowerCase())),
  ), [tools, category, search]);

  async function action(run: () => Promise<unknown>, message: string) {
    try { await run(); setToast(message); } catch (caught) { setToast(errorMessage(caught)); }
  }
  async function remove(tool: Tool, admin = false) {
    if (!window.confirm(`Remove “${tool.name}”? Its loan history will be preserved.`)) return;
    await action(() => admin ? adminRemoveTool({ toolId: tool._id }) : removeTool({ toolId: tool._id }), "Listing removed");
  }

  if (isLoading || !isAuthenticated || !synced || me === undefined) return <div className="loading-screen"><div className="spinner" aria-label="Loading dashboard" /></div>;

  const pendingIncoming = incoming?.filter((item) => item.status === "pending").length ?? 0;
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "browse", label: "Browse tools" }, { id: "listings", label: "My listings", count: myListings?.filter((item) => !item.isArchived).length },
    { id: "requests", label: "My requests", count: myRequests?.length }, { id: "incoming", label: "Incoming", count: pendingIncoming }, { id: "loans", label: "Loans", count: loans?.filter((loan) => loan.status === "active").length },
    ...(me?.role === "admin" ? [{ id: "admin" as Tab, label: "Admin" }] : []),
  ];

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header"><div className="dashboard-header-inner shell"><Logo href="/dashboard" /><div className="dashboard-user">{me?.isTrustedLender && <span className="pill trusted"><BadgeCheck size={14} /> Trusted lender</span>}<UserButton /></div></div></header>
      <main className="dashboard-main shell">
        <div className="dashboard-title-row"><div><h1>{tab === "browse" ? `Welcome, ${me?.name?.split(" ")[0] ?? "neighbor"}` : tabs.find((item) => item.id === tab)?.label}</h1><p>{tab === "browse" ? "What could you borrow instead of buy today?" : "Keep your neighborhood lending loop moving."}</p></div><button className="button button-primary" onClick={() => setToolModal("new")}><Plus size={18} /> List a tool</button></div>
        <div className="tabs" role="tablist">{tabs.map((item) => <button key={item.id} className={`tab ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)} role="tab" aria-selected={tab === item.id}>{item.label}{item.count !== undefined && <span className="tab-badge">{item.count}</span>}</button>)}</div>

        {tab === "browse" && <>
          <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">Search tools</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools" /></label><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter category"><option value="">All categories</option>{TOOL_CATEGORIES.map((item) => <option key={item} value={item}>{formatCategory(item)}</option>)}</select></div>
          {filteredTools.length ? <div className="dashboard-grid">{filteredTools.map((tool) => <article className="listing-card" key={tool._id}><div className="listing-card-top"><span className="tool-icon"><Wrench size={20} /></span><span className={`pill ${tool.available ? "available" : "unavailable"}`}>{tool.available ? "Available today" : "On loan today"}</span></div><h3>{tool.name}</h3><div className="metadata"><span className="pill">{formatCategory(tool.category)}</span><span className="pill">{tool.condition.replace("-", " ")}</span></div><p className="description">{tool.description}</p><div className="metadata"><span className="pill">By {tool.ownerName}</span>{tool.trustedLender && <span className="pill trusted"><BadgeCheck size={13} /> Trusted</span>}</div>{tool.ownerId !== me?._id && <div className="card-actions"><button className="button button-primary button-small" onClick={() => setBorrowTool(tool)}><CalendarDays size={14} /> Request dates</button></div>}</article>)}</div> : <Empty title="No matching tools" body="Try a different search or be the first to list one." />}
        </>}

        {tab === "listings" && <>{myListings?.filter((tool) => !tool.isArchived).length ? <div className="dashboard-grid">{myListings.filter((tool) => !tool.isArchived).map((tool) => <article className="listing-card" key={tool._id}><div className="listing-card-top"><span className="tool-icon"><Wrench size={20} /></span><span className="pill">{formatCategory(tool.category)}</span></div><h3>{tool.name}</h3><p className="description">{tool.description}</p><div className="metadata"><span className="pill">{tool.condition.replace("-", " ")}</span></div><div className="card-actions"><button className="button button-outline button-small" onClick={() => setToolModal(tool)}>Edit</button><button className="button button-danger button-small" onClick={() => remove(tool)}><Trash2 size={14} /> Remove</button></div></article>)}</div> : <Empty title="You haven’t listed a tool yet" body="Put something useful back into circulation." />}</>}

        {tab === "requests" && <div className="list-panel">{myRequests?.length ? myRequests.map((request) => <div className="request-row" key={request._id}><div><strong>{request.toolName}</strong><small>From {request.lenderName}</small></div><div><span>{formatDate(request.startDate)} – {formatDate(request.endDate)}</span><small>Requested dates</small></div><div><span className={`status status-${request.status}`}>{request.status}</span></div><div className="request-actions">{request.status === "pending" && <button className="button button-outline button-small" onClick={() => action(() => cancel({ requestId: request._id }), "Request cancelled")}>Cancel</button>}</div></div>) : <Empty title="No requests yet" body="Browse available tools and ask a neighbor to borrow one." />}</div>}

        {tab === "incoming" && <div className="list-panel">{incoming?.length ? incoming.map((request) => <div className="request-row" key={request._id}><div><strong>{request.toolName}</strong><small>Requested by {request.borrowerName}</small></div><div><span>{formatDate(request.startDate)} – {formatDate(request.endDate)}</span><small>Requested dates</small></div><div><span className={`status status-${request.status}`}>{request.status}</span></div><div className="request-actions">{request.status === "pending" && <><button className="button button-secondary button-small" onClick={() => action(() => decide({ requestId: request._id, decision: "approved" }), "Request approved")}><Check size={14} /> Approve</button><button className="button button-danger button-small" onClick={() => action(() => decide({ requestId: request._id, decision: "declined" }), "Request declined")}><X size={14} /> Decline</button></>}</div></div>) : <Empty title="Nothing waiting for you" body="New borrowing requests will appear here." />}</div>}

        {tab === "loans" && <div className="list-panel">{loans?.length ? loans.map((loan) => <LoanRow key={loan._id} loan={loan} notify={setToast} />) : <Empty title="No loans yet" body="Approved requests become loans and appear here." />}</div>}

        {tab === "admin" && me?.role === "admin" && <><div className="admin-banner"><ShieldCheck size={18} /> Admin actions are authorized again in Convex; this view is not the security boundary.</div><h3>Community members</h3><div className="list-panel">{adminUsers?.map((user) => <div className="admin-user-row" key={user._id}><div><strong>{user.name}</strong><small>{user.email} · {user.role}</small></div><button className={`button button-small ${user.isTrustedLender ? "button-outline" : "button-secondary"}`} onClick={() => action(() => setTrusted({ userId: user._id, trusted: !user.isTrustedLender }), user.isTrustedLender ? "Trusted status removed" : "Trusted lender assigned")}>{user.isTrustedLender ? "Remove trusted" : "Mark trusted"}</button></div>)}</div><h3 style={{ marginTop: 28 }}>All loans</h3><div className="list-panel">{adminLoans?.length ? adminLoans.map((loan) => <LoanRow key={loan._id} loan={loan} notify={setToast} />) : <Empty title="No community loans" body="Approved loans will be visible here." />}</div><h3 style={{ marginTop: 28 }}>Listing moderation</h3><div className="dashboard-grid">{tools?.map((tool) => <article className="listing-card" key={tool._id}><h3>{tool.name}</h3><p className="description">By {tool.ownerName} · {formatCategory(tool.category)}</p><button className="button button-danger button-small" onClick={() => remove(tool, true)}><Trash2 size={14} /> Remove listing</button></article>)}</div></>}
      </main>
      {toolModal && <ToolForm tool={toolModal === "new" ? undefined : toolModal} onClose={() => setToolModal(null)} onSaved={setToast} />}
      {borrowTool && <BorrowForm tool={borrowTool} onClose={() => setBorrowTool(null)} onSaved={setToast} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
