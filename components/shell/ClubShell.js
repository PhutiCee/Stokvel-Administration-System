"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Wallet, ArrowLeftRight, BookLock, Scale, Users, ScrollText,
  HeartHandshake, FileText, Menu, X, ChevronDown, LogOut, RotateCcw, Building2, Check, Gauge
} from "lucide-react";
import { cx, initials } from "@/lib/format";
import { can } from "@/lib/rules/permissions";
import { useSession, useData } from "@/lib/data";
import { resetDemo } from "@/lib/store";
import Badge from "@/components/ui/Badge";

// Navigation is built from the workflows a role actually performs, not from the
// database tables. A Member sees four items; a Treasurer sees nine. Showing a
// Member eight forbidden doors is worse than showing them the four that open.
const NAV = [
  { section: null, items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "view.dashboard" }] },
  {
    section: "Money",
    items: [
      { href: "/contributions", label: "Contributions", icon: Wallet, permission: "contribution.capture" },
      { href: "/payouts", label: "Payouts", icon: ArrowLeftRight, permission: "view.queue" },
      { href: "/claims", label: "Burial claims", icon: HeartHandshake, permission: "view.queue", clubType: "Burial" },
      { href: "/ledger", label: "Ledger", icon: BookLock, permission: "view.ledger" },
      { href: "/reconciliation", label: "Reconciliation", icon: Scale, permission: "view.reconciliation" },
      { href: "/statement", label: "My statement", icon: FileText, permission: "view.ownStatement" }
    ]
  },
  {
    section: "Club",
    items: [
      { href: "/members", label: "Members", icon: Users, permission: "view.members" },
      { href: "/constitution", label: "Constitution", icon: ScrollText, permission: "view.constitution" }
    ]
  }
];

function useNav() {
  const { role, club } = useSession();
  if (!role || !club) return [];
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (i) => (!i.clubType || i.clubType === club.type) && can(role, i.permission)
    )
  })).filter((g) => g.items.length);
}

export default function ClubShell({ children }) {
  const { user, club, role, membership, memberships, selectClub, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [clubMenu, setClubMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const nav = useNav();

  useEffect(() => { setMobileOpen(false); setClubMenu(false); setUserMenu(false); }, [pathname]);

  useEffect(() => {
    if (!user) router.replace("/login");
    else if (!club) router.replace("/select-club");
  }, [user, club, router]);

  if (!user || !club) {
    return <div className="min-h-screen grid place-items-center text-sm text-ink-500">Loading…</div>;
  }

  const sidebar = (
    <div className="flex flex-col h-full on-navy">
      {/* Club context. SRS 3.1: the club and the user's role in it must be visible
          on every screen so a multi-club user cannot mistake the active context. */}
      <div className="px-3 pt-3 pb-2 relative">
        <button
          onClick={() => setClubMenu((v) => !v)}
          aria-expanded={clubMenu}
          className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-white/[0.07] transition-colors"
        >
          <span className="w-8 h-8 rounded-md bg-accent-600 text-white grid place-items-center text-[12px] font-bold shrink-0">
            {initials(club.shortName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-white truncate">{club.shortName}</span>
            <span className="block text-[11px] text-white/55 truncate">{club.type} · {role}</span>
          </span>
          <ChevronDown size={14} className={cx("text-white/50 transition-transform", clubMenu && "rotate-180")} />
        </button>

        {clubMenu && (
          <div className="absolute left-3 right-3 top-[68px] z-40 bg-surface rounded-lg shadow-pop border border-line py-1.5 animate-in">
            <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Switch club</p>
            {memberships.map((m) => (
              <ClubOption
                key={m.id}
                membership={m}
                active={m.clubId === club.id}
                onSelect={() => { selectClub(m.clubId); router.push("/dashboard"); }}
              />
            ))}
            <div className="border-t border-line mt-1.5 pt-1.5">
              <Link href="/select-club" className="block px-3 py-2 text-[13px] text-ink-700 hover:bg-canvas rounded mx-1">
                All my clubs
              </Link>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 no-scrollbar" aria-label="Main">
        {nav.map((group, gi) => (
          <div key={gi} className="mt-4 first:mt-1">
            {group.section && (
              <p className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">{group.section}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
                        active ? "bg-white/[0.11] text-white font-medium" : "text-white/65 hover:text-white hover:bg-white/[0.06]"
                      )}
                    >
                      <Icon size={16} className="shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-white/10">
        <p className="px-1 text-[10px] uppercase tracking-[0.08em] text-white/35 mb-1.5">Prototype</p>
        <button onClick={resetDemo} className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-[12px] text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors">
          <RotateCcw size={14} aria-hidden /> Reset demo data
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[248px] bg-navy-950 border-r border-navy-800 flex-col z-30">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[272px] bg-navy-950 shadow-pop animate-in">
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute top-4 right-3 text-white/60 p-1 z-10">
              <X size={18} />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-[248px]">
        {/* Topbar */}
        <header className="sticky top-0 z-20 bg-navy-950 lg:bg-surface/85 lg:backdrop-blur border-b border-navy-800 lg:border-line no-print">
          <div className="h-14 px-4 sm:px-6 flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="lg:hidden text-white p-1.5 -ml-1.5 rounded on-navy">
              <Menu size={20} />
            </button>

            <div className="lg:hidden min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white truncate">{club.shortName}</p>
              <p className="text-[11px] text-white/55 truncate">{role}</p>
            </div>

            <div className="hidden lg:block min-w-0 flex-1">
              <p className="text-[13px] text-ink-500 truncate">
                <span className="font-medium text-ink-900">{club.name}</span>
                <span className="mx-2 text-line-strong">/</span>
                {club.town}
              </p>
            </div>

            <DemoRoleSwitcher />

            <div className="relative">
              <button
                onClick={() => setUserMenu((v) => !v)}
                aria-expanded={userMenu}
                aria-label="Account menu"
                className={cx("flex items-center gap-2 rounded-full pl-1 pr-1 py-1 transition-colors", "hover:bg-white/10 lg:hover:bg-ink-900/5")}
              >
                <span className="w-8 h-8 rounded-full bg-accent-600 text-white grid place-items-center text-[12px] font-semibold">
                  {initials(user.fullName)}
                </span>
              </button>
              {userMenu && (
                <div className="absolute right-0 top-11 w-60 bg-surface rounded-lg shadow-pop border border-line py-1.5 z-40 animate-in">
                  <div className="px-3 py-2 border-b border-line">
                    <p className="text-[13px] font-semibold text-ink-900 truncate">{user.fullName}</p>
                    <p className="text-[12px] text-ink-500 truncate">{user.email}</p>
                    {membership && <Badge tone="accent" className="mt-2">{role} · {club.shortName}</Badge>}
                  </div>
                  <button
                    onClick={() => { signOut(); router.push("/login"); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-ink-700 hover:bg-canvas text-left"
                  >
                    <LogOut size={14} aria-hidden /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto print-full">
          {children}
        </main>
      </div>
    </div>
  );
}

function ClubOption({ membership, active, onSelect }) {
  const { state } = useData();
  const club = state.clubs.find((c) => c.id === membership.clubId);
  if (!club) return null;
  return (
    <button onClick={onSelect} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-canvas transition-colors">
      <Building2 size={15} className="text-ink-400 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink-900 truncate">{club.shortName}</span>
        <span className="block text-[11px] text-ink-500">{membership.role}</span>
      </span>
      {active && <Check size={14} className="text-accent-600 shrink-0" aria-hidden />}
    </button>
  );
}

/**
 * PROTOTYPE ONLY. Dual authorisation needs two officers (REQ-64). In a live
 * demonstration you cannot log in twice, so this switches the acting account.
 * It is deliberately styled as a demo control, not as product chrome, and would
 * not exist in the production build.
 */
function DemoRoleSwitcher() {
  const { state } = useData();
  const { club, userId, dispatch } = useSession();
  const [open, setOpen] = useState(false);
  if (!club) return null;

  const candidates = state.members
    .filter((m) => m.clubId === club.id && ["Chairperson", "Treasurer", "Secretary"].includes(m.role))
    .concat(state.members.filter((m) => m.clubId === club.id && m.role === "Member" && m.standing === "Good standing").slice(0, 1));

  const current = state.members.find((m) => m.clubId === club.id && m.userId === userId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-warn-600/40 bg-warn-50 text-warn-700 px-2.5 h-8 text-[11px] font-medium hover:bg-warn-100 transition-colors"
        title="Prototype control: switch the acting account"
      >
        <Gauge size={12} aria-hidden />
        <span className="hidden sm:inline">Demo:</span>
        <span className="max-w-[92px] truncate">{current?.role || "Member"}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-10 w-72 bg-surface rounded-lg shadow-pop border border-line py-1.5 z-40 animate-in">
          <p className="px-3 py-1.5 text-[11px] text-ink-500 leading-relaxed border-b border-line mb-1">
            Prototype control. Switches the acting account so dual authorisation can be shown in one sitting. Not part of the product.
          </p>
          {candidates.map((m) => (
            <button
              key={m.id}
              onClick={() => { dispatch({ type: "SET_SESSION", payload: { userId: m.userId } }); setOpen(false); }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-canvas transition-colors"
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-ink-900 truncate">{m.fullName}</span>
                <span className="block text-[11px] text-ink-500">{m.role}</span>
              </span>
              {m.userId === userId && <Check size={14} className="text-accent-600" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
