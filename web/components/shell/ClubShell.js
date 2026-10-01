"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Receipt,
  BookOpen,
  LogOut,
  ArrowLeftRight,
  Menu,
  X,
  FileText,
  Wallet,
  ListOrdered,
  PiggyBank,
  HeartHandshake,
  MessageCircle, Bell, Scale,
} from "lucide-react";
import { Mark } from "@/components/Wordmark";
import { Badge } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/format";

// Visibility is a convenience; the API remains the permission boundary.
const NAV = [
  {href:'/notifications',label:'Notifications',icon:Bell,permission:'notification.view'},
  {href:'/reconciliation',label:'Reconciliation',icon:Scale,permission:'view.reconciliation'},
  {
    href: "/announcements",
    label: "Announcements",
    icon: MessageCircle,
    permission: "view.dashboard",
  },
  {
    href: "/beneficiaries",
    label: "Beneficiaries",
    icon: Users,
    permission: "beneficiary.manage",
  },
  { href: "/exits", label: "Exits", icon: LogOut, permission: "exit.notice" },
  {
    href: "/governance",
    label: "Governance",
    icon: FileText,
    permission: "view.governance",
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "view.dashboard",
  },
  {
    href: "/contributions",
    label: "Contributions",
    icon: Receipt,
    permission: "view.dashboard",
  },
  {
    href: "/payouts",
    label: "Payouts",
    icon: Wallet,
    permission: "payout.view",
    clubType: "Rotating",
  },
  {
    href: "/queue",
    label: "Queue",
    icon: ListOrdered,
    permission: "view.queue",
    clubType: "Rotating",
  },
  {
    href: "/distributions",
    label: "Distributions",
    icon: PiggyBank,
    permission: "distribution.view",
    clubType: "Accumulating",
  },
  {
    href: "/claims",
    label: "Claims",
    icon: HeartHandshake,
    permission: "claim.lodge",
    clubType: "Burial",
  },
  {
    href: "/members",
    label: "Members",
    icon: Users,
    permission: "view.members",
  },
  {
    href: "/statement",
    label: "My statement",
    icon: FileText,
    permission: "view.ownStatement",
  },
  {
    href: "/ledger",
    label: "Ledger",
    icon: BookOpen,
    permission: "view.ledger",
  },
  {
    href: "/assistant",
    label: "Assistant",
    icon: MessageCircle,
    permission: "assistant.ask",
  },
];

const GROUPS = [
  { label: "Overview", paths: ["/dashboard", "/announcements", "/notifications"] },
  { label: "Money", paths: ["/contributions", "/payouts", "/queue", "/distributions", "/claims", "/ledger", "/reconciliation"] },
  { label: "Club", paths: ["/members", "/governance"] },
  { label: "My membership", paths: ["/statement", "/beneficiaries", "/exits", "/assistant"] },
];

export default function ClubShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, club, role, can, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.paths.map((path) => NAV.find((item) => item.href === path))
      .filter((item) => can(item.permission) && (!item.clubType || item.clubType === club?.clubType)),
  })).filter((group) => group.items.length);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-canvas" onKeyDown={(event) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 bg-white p-3 text-accent-700">
        Skip to content
      </a>
      <header className="bg-white border-b no-print">
        <div className="flex min-h-20 items-center justify-between gap-3 px-5 sm:px-8 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Mark size={30} />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold break-words">{club?.name || "Loading club…"}</p>
              <p className="text-[12px] text-ink-500">{role}{club?.clubType ? ` · ${club.clubType}` : ""}</p>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-4 text-[13px]">
            <span className="text-ink-500">{user?.fullName}</span>
            <Link href="/select-club" className="inline-flex items-center gap-2 min-h-11 text-accent-700"><ArrowLeftRight size={15} aria-hidden />Switch club</Link>
            <button onClick={handleSignOut} className="inline-flex items-center gap-2 min-h-11 text-ink-700"><LogOut size={15} aria-hidden />Sign out</button>
          </div>
          <button ref={menuButton} onClick={() => setMenuOpen((open) => !open)}
            className="lg:hidden inline-flex items-center justify-center gap-2 shrink-0 min-h-11 px-3 border rounded text-[14px]"
            aria-expanded={menuOpen} aria-controls="club-navigation">
            {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </header>
      <div className="lg:flex lg:min-h-[calc(100vh-80px)]">
        <aside id="club-navigation" className={cx("no-print bg-white border-b lg:border-b-0 lg:border-r lg:w-56 lg:shrink-0", menuOpen ? "block" : "hidden lg:block")}>
          <nav aria-label="Club sections" className="p-4 space-y-5 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="px-3 mb-1 text-[11px] font-semibold tracking-wider uppercase text-ink-500">{group.label}</h2>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    return <li key={item.href}><Link href={item.href}
                      onClick={() => setMenuOpen(false)} aria-current={active ? "page" : undefined}
                      className={cx("flex items-center gap-3 min-h-11 px-3 rounded text-[14px] border-l-2 transition-colors",
                        active ? "bg-accent-50 border-accent-600 text-accent-700 font-medium" : "border-transparent text-ink-700 hover:bg-canvas hover:text-ink-900")}>
                      <item.icon size={17} aria-hidden />{item.href === "/queue" ? "Payout queue" : item.label}
                    </Link></li>;
                  })}
                </ul>
              </section>
            ))}
            <div className="lg:hidden border-t pt-3 text-[14px]">
              <p className="px-3 text-ink-500 text-[12px]">{user?.fullName}</p>
              <Link href="/select-club" className="flex items-center gap-3 min-h-11 px-3 text-accent-700"><ArrowLeftRight size={17} aria-hidden />Switch club</Link>
              <button onClick={handleSignOut} className="flex items-center gap-3 min-h-11 px-3"><LogOut size={17} aria-hidden />Sign out</button>
            </div>
          </nav>
        </aside>
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 w-full max-w-7xl mx-auto px-5 sm:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

/** A heading with optional description and an action on the right. */
export function PageHeader({ title, description, action, className }) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-start justify-between gap-4 mb-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-900">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[14px] text-ink-500 leading-relaxed max-w-[60ch]">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export { Badge };
