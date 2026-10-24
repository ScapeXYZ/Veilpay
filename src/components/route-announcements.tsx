"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Next's empty route announcer is navigation status, not an application error. */
export function RouteAnnouncements() {
  const pathname = usePathname();
  useEffect(() => {
    const sync = () => {
      const node = document.querySelector("next-route-announcer")?.shadowRoot?.querySelector("[role]");
      if (node) {
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
