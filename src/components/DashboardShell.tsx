"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionPayload } from "@/lib/types";

type Props = {
  user: SessionPayload;
  children: React.ReactNode;
};

type MenuItem = {
  label: string;
  href: string;
  icon: () => React.ReactNode;
  children?: { label: string; href: string }[];
};

const menuItems: MenuItem[] = [
  { label: "Home", href: "/dashboard", icon: HomeIcon },
  {
    label: "Exportaciones",
    href: "/dashboard/exportaciones",
    icon: ExportIcon,
    children: [
      { label: "Estadísticas Generales", href: "/dashboard/exportaciones/estadisticas" },
    ],
  },
  { label: "Importaciones", href: "/dashboard/importaciones", icon: ImportIcon, children: [
    { label: "Estadísticas Generales", href: "/dashboard/importaciones/estadisticas" },
    { label: "Impuestos Importaciones", href: "/dashboard/importaciones/impuestos" },
  ] },
];

export default function DashboardShell({ user, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  function isActive(item: MenuItem) {
    if (item.href === "/dashboard") return pathname === item.href;
    return pathname === item.href;
  }

  function isParentActive(item: MenuItem) {
    if (item.href === "/dashboard") return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-base-100 border-r border-base-300 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-base-300">
          <Link href="/dashboard">
            <Image
              src="/logo_agatrack.png"
              alt="AGATrack"
              width={160}
              height={50}
              priority
            />
          </Link>
        </div>

        {/* Menu */}
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="menu gap-1">
            {menuItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={isActive(item) ? "active" : isParentActive(item) ? "font-semibold" : ""}
                >
                  <item.icon />
                  {item.label}
                </Link>
                {item.children && isParentActive(item) && (
                  <ul className="ml-2">
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={pathname === child.href ? "active" : ""}
                        >
                          <ChartIcon />
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-base-100 border-b border-base-300 flex items-center justify-end px-6">
          <div className="dropdown dropdown-end">
            <div
              tabIndex={0}
              role="button"
              className="flex items-center gap-3 cursor-pointer hover:opacity-80"
            >
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium leading-tight">
                  {user.nombre || "Empresa"}
                </p>
                <p className="text-xs text-base-content/60 font-mono">
                  {user.rut}
                </p>
              </div>
              <div className="avatar placeholder">
                <div className="bg-primary text-primary-content rounded-full w-10">
                  <span className="text-sm font-bold">
                    {(user.nombre?.[0] ?? user.rut[0]).toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content menu bg-base-100 rounded-box z-50 w-52 p-2 shadow-lg border border-base-300 mt-2"
            >
              <li className="menu-title">
                <span className="font-mono text-xs">{user.rut}</span>
              </li>
              <li>
                <button onClick={handleLogout} className="text-error">
                  Cerrar sesión
                </button>
              </li>
            </ul>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6 bg-base-200">
          {children}
        </main>
      </div>
    </div>
  );
}

/* Icons */
function HomeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
      />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m0 0l-4-4m4 4l4-4M4 12h16"
      />
    </svg>
  );
}
