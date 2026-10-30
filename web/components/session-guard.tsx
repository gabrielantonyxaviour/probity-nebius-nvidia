"use client";
import { useEffect } from "react";
import { account } from "@/lib/api";

/** The middleware only sees that a session cookie exists; this confirms it is still valid and sends the visitor to sign-in if not. */
export function SessionGuard() {
  useEffect(() => {
    account.me().then((m) => {
      if (!m.user) window.location.replace(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }).catch(() => undefined);
  }, []);
  return null;
}
