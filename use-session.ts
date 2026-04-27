"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/http";

type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  role: "STUDENT" | "ADMIN";
};

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<{ user: SessionUser }>("/api/auth/session")
      .then((data) => {
        if (active) setUser(data.user);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { user, loading };
}
