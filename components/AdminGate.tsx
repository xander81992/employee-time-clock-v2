"use client";

import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { configureAuthPersistence, getFirebaseServices } from "@/lib/firebase";
import LoadingScreen from "@/components/LoadingScreen";

export default function AdminGate({
  children
}: {
  children: (user: User) => ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    let unsubscribe = () => {};

    async function start() {
      try {
        await configureAuthPersistence();
        const { auth, db } = getFirebaseServices();

        unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          if (!mounted) return;

          if (!currentUser || currentUser.isAnonymous) {
            setChecking(false);
            router.replace("/admin/login");
            return;
          }

          const adminSnapshot = await getDoc(doc(db, "admins", currentUser.uid));
          const isAdmin = adminSnapshot.exists()
            && adminSnapshot.data()?.role === "admin";

          if (!isAdmin) {
            await signOut(auth);
            setChecking(false);
            router.replace("/admin/login?error=not-admin");
            return;
          }

          setUser(currentUser);
          setChecking(false);
        });
      } catch {
        setChecking(false);
        router.replace("/admin/login?error=config");
      }
    }

    void start();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [router]);

  if (checking || !user) {
    return <LoadingScreen message="Checking administrator access…" />;
  }

  return <>{children(user)}</>;
}
