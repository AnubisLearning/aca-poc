import React from "react";
import { NavLink } from "react-router-dom";
import { Activity, Settings, ListOrdered, BarChart2, ShieldCheck } from "lucide-react";
import { clsx } from "clsx";

const links = [
  { to: "/", label: "Dashboard", icon: BarChart2 },
  { to: "/configs", label: "Configs", icon: Settings },
  { to: "/jobs", label: "Job History", icon: ListOrdered },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
];

export const Navbar: React.FC = () => (
  <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-950 border-b border-gray-800 h-14 flex items-center px-6 gap-8">
    <div className="flex items-center gap-2 mr-6">
      <Activity className="w-6 h-6 text-blue-500" />
      <span className="font-bold text-white text-lg tracking-tight">ACA</span>
      <span className="text-gray-500 text-sm font-light ml-1">Canary Analysis</span>
    </div>

    <div className="flex items-center gap-1">
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
            )
          }
        >
          <Icon className="w-4 h-4" />
          {label}
        </NavLink>
      ))}
    </div>
  </nav>
);
