"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { configureAuthPersistence, getFirebaseServices } from "@/lib/firebase";
import { friendlyFirebaseError } from "@/lib/errors";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get("error");

    if (errorCode === "not-admin") {
      setError("This Firebase account is not listed as an administrator.");
    }

    if (errorCode === "config") {
      setError("Firebase is not configured correctly in Vercel.");
    }
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};

    async function initialize() {
      try {
        await configureAuthPersistence();
        const { auth, db } = getFirebaseServices();

        unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          if (!currentUser || currentUser.isAnonymous) {
            setReady(true);
            return;
          }

          const adminSnapshot = await getDoc(doc(db, "admins", currentUser.uid));
          if (adminSnapshot.exists() && adminSnapshot.data()?.role === "admin") {
            router.replace("/admin");
            return;
          }

          await signOut(auth);
          setReady(true);
        });
      } catch (initializationError) {
        setError(friendlyFirebaseError(initializationError));
        setReady(true);
      }
    }

    void initialize();
    return () => unsubscribe();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await configureAuthPersistence();
      const { auth, db } = getFirebaseServices();
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password
      );

      const adminSnapshot = await getDoc(doc(db, "admins", credential.user.uid));
      const isAdmin = adminSnapshot.exists()
        && adminSnapshot.data()?.role === "admin";

      if (!isAdmin) {
        await signOut(auth);
        setError(
          "The login worked, but this User UID is not configured in Firestore as an administrator."
        );
        return;
      }

      router.replace("/admin");
    } catch (loginError) {
      setError(friendlyFirebaseError(loginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">TC</div>
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1>Attendance Dashboard</h1>
        <p className="muted">Sign in with the administrator account created in Firebase Authentication.</p>

        <label>
          Email address
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@company.com"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button className="button primary full" disabled={busy || !ready} type="submit">
          {busy ? "Signing in…" : ready ? "Sign In" : "Loading Firebase…"}
        </button>

        <a className="text-link" href="/kiosk">Open employee clock</a>
      </form>
    </main>
  );
}
