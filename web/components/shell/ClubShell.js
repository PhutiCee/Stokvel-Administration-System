"use client";

/**
 * The chrome around every in-club screen.
 *
 * The club name sits in the header, permanently, in the navy bar. That is
 * deliberate: a treasurer who belongs to three clubs is one careless click away
 * from capturing a payment against the wrong one, and the only defence the
 * interface can offer is to never let them forget which club they are in.
 *
 * Navigation is filtered by permission, which decides only what to RENDER.
 * Every request is authorised again on the server against the role held in the
 * active club (REQ-8).
 */

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { LayoutDashboard, Users, Receipt, BookOpen, ChevronDown, LogOut, ArrowLeftRight, Menu, X } from "lucide-react";
import { Mark } from "@/components/Wordmark";
import { Badge } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { cx, initials } from "@/lib/format";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "view.dashboard" },
  { href: "/members", label: "Members", icon: Users, permission: "view.members" },
  { href: "/contributions", label: "Contributions", icon: Receipt, permission: "contribution.capture" },
  { href: "/ledger", label: "Ledger", icon: BookOpen, permission: "view.ledger" }
];

export default function ClubShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, club, role, can, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = NAV.filter((n) => can(n.permission));

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  async function switchClub() {
    router.push("/select-club");
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="bg-navy-950 text-white on-navy">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Mark size={26} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold truncate leading-tight">
                  {club?.name || "Loading"}
                </p>
                <p className="text-[12px] text-white/50 leading-tight">
                  {role} {club?.clubType ? `· ${club.clubType}` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={switchClub}
                className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded text-[13px]
                           text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <ArrowLeftRight size={13} aria-hidden />
                Switch club
              </button>

              <div className="hidden sm:flex items-center gap-2.5 pl-2 border-l border-white/15">
                <span
                  className="grid place-items-center w-7 h-7 rounded-full bg-white/10 text-[11px] font-semibold"
                  aria-hidden
                >
                  {initials(user?.fullName || "")}
                </span>
                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-[13px]
                             text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <LogOut size={13} aria-hidden />
                  Sign out
                </button>
              </div>

              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="sm:hidden grid place-items-center w-9 h-9 rounded hover:bg-white/10"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>

          {/* Desktop navigation */}
          <nav className="hidden sm:flex gap-1 -mb-px" aria-label="Club sections">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "inline-flex items-center gap-2 px-3 h-11 text-[13.5px] border-b-2 transition-colors",
                    active
                      ? "border-white text-white font-medium"
                      : "border-transparent text-white/55 hover:text-white/90"
                  )}
                >
                  <item.icon size={15} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="sm:hidden border-t border-white/10 px-5 py-3 space-y-1 animate-in">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cx(
                  "flex items-center gap-2.5 h-10 px-2 rounded text-[14px]",
                  pathname === item.href ? "bg-white/10 text-white font-medium" : "text-white/70"
                )}
              >
                <item.icon size={16} aria-hidden />
                {item.label}
              </Link>
            ))}
            <div className="pt-2 mt-2 border-t border-white/10 space-y-1">
              <button
                onClick={switchClub}
                className="flex w-full items-center gap-2.5 h-10 px-2 rounded text-[14px] text-white/70"
              >
                <ArrowLeftRight size={16} aria-hidden />
                Switch club
              </button>
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2.5 h-10 px-2 rounded text-[14px] text-white/70"
              >
                <LogOut size={16} aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-8 py-8">{children}</main>
    </div>
  );
}

/** A heading with optional description and an action on the right. */
export function PageHeader({ title, description, action, className }) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-4 mb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-900">{title}</h1>
        {description && (
          <p className="mt-1 text-[14px] text-ink-500 leading-relaxed max-w-[60ch]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export { Badge };