"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  type User
} from "firebase/auth";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from "firebase/firestore";
import { configureAuthPersistence, getFirebaseServices } from "@/lib/firebase";
import { friendlyFirebaseError } from "@/lib/errors";

const timeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit"
});

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric"
});

type ActionType = "IN" | "OUT";

type SuccessState = {
  name: string;
  action: ActionType;
};

export default function KioskPage() {
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [now, setNow] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};

    async function initialize() {
      try {
        await configureAuthPersistence();
        const { auth } = getFirebaseServices();

        unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          if (currentUser) {
            setFirebaseUser(currentUser);
            setReady(true);
            return;
          }

          try {
            const credential = await signInAnonymously(auth);
            setFirebaseUser(credential.user);
            setReady(true);
          } catch (anonymousError) {
            setError(friendlyFirebaseError(anonymousError));
            setReady(true);
          }
        });
      } catch (initializationError) {
        setError(friendlyFirebaseError(initializationError));
        setReady(true);
      }
    }

    void initialize();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (ready) inputRef.current?.focus();
  }, [ready]);

  const disabled = useMemo(
    () => busy || !ready || !firebaseUser || employeeNumber.length !== 4,
    [busy, ready, firebaseUser, employeeNumber]
  );

  async function recordTime(action: ActionType) {
    if (!firebaseUser) {
      setError("The kiosk is not connected to Firebase yet.");
      return;
    }

    if (!/^\d{4}$/.test(employeeNumber)) {
      setError("Enter your four-digit employee number.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess(null);

    try {
      const { db } = getFirebaseServices();
      const employeeRef = doc(db, "employees", employeeNumber);

      const employeeName = await runTransaction(db, async (transaction) => {
        const employeeSnapshot = await transaction.get(employeeRef);

        if (!employeeSnapshot.exists()) {
          throw new Error("EMPLOYEE_NOT_FOUND");
        }

        const employee = employeeSnapshot.data();
        const name = String(employee.name ?? "Employee");

        if (!employee.active) {
          throw new Error("EMPLOYEE_INACTIVE");
        }

        const activeShiftId = employee.activeShiftId
          ? String(employee.activeShiftId)
          : null;

        if (action === "IN") {
          if (activeShiftId) {
            throw new Error("ALREADY_CLOCKED_IN");
          }

          const shiftRef = doc(collection(db, "shifts"));

          transaction.set(shiftRef, {
            employeeId: employeeNumber,
            employeeNumber,
            employeeName: name,
            entryType: "WORK",
            status: "OPEN",
            timeIn: serverTimestamp(),
            timeOut: null,
            paidMinutes: 0,
            note: "",
            source: "KIOSK",
            kioskUserId: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          transaction.update(employeeRef, {
            activeShiftId: shiftRef.id,
            lastActionAt: serverTimestamp()
          });
        } else {
          if (!activeShiftId) {
            throw new Error("NOT_CLOCKED_IN");
          }

          const shiftRef = doc(db, "shifts", activeShiftId);
          const shiftSnapshot = await transaction.get(shiftRef);

          if (!shiftSnapshot.exists()) {
            throw new Error("OPEN_SHIFT_MISSING");
          }

          transaction.update(shiftRef, {
            status: "CLOSED",
            timeOut: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          transaction.update(employeeRef, {
            activeShiftId: null,
            lastActionAt: serverTimestamp()
          });
        }

        return name;
      });

      setSuccess({ name: employeeName, action });
      setEmployeeNumber("");
      window.setTimeout(() => {
        setSuccess(null);
        inputRef.current?.focus();
      }, 5000);
    } catch (recordError) {
      if (recordError instanceof Error) {
        const messages: Record<string, string> = {
          EMPLOYEE_NOT_FOUND: "Employee number was not found.",
          EMPLOYEE_INACTIVE: "This employee number is inactive. Contact a supervisor.",
          ALREADY_CLOCKED_IN: "You are already clocked in.",
          NOT_CLOCKED_IN: "You are not currently clocked in.",
          OPEN_SHIFT_MISSING: "The open shift could not be found. Contact an administrator."
        };

        setError(messages[recordError.message] ?? friendlyFirebaseError(recordError));
      } else {
        setError("Unable to record the attendance entry.");
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className="kiosk-page">
      <section className="kiosk-card">
        <header className="kiosk-header">
          <div className="brand-mark large">TC</div>
          <div>
            <p className="eyebrow">EMPLOYEE ATTENDANCE</p>
            <h1>Time Clock</h1>
          </div>
        </header>

        <div className="live-clock" aria-live="polite">
          <strong>{timeFormatter.format(now)}</strong>
          <span>{dateFormatter.format(now)}</span>
        </div>

        <form onSubmit={submit} className="kiosk-form">
          <label htmlFor="employee-number">Enter your four-digit employee number</label>
          <input
            ref={inputRef}
            id="employee-number"
            className="pin-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={employeeNumber}
            onChange={(event) => {
              setEmployeeNumber(event.target.value.replace(/\D/g, "").slice(0, 4));
              setError("");
              setSuccess(null);
            }}
            placeholder="0000"
            aria-label="Four-digit employee number"
          />

          <div className="kiosk-actions">
            <button
              className="clock-button clock-in"
              disabled={disabled}
              onClick={() => recordTime("IN")}
              type="button"
            >
              <span>Time In</span>
              <small>Start your shift</small>
            </button>

            <button
              className="clock-button clock-out"
              disabled={disabled}
              onClick={() => recordTime("OUT")}
              type="button"
            >
              <span>Time Out</span>
              <small>End your shift</small>
            </button>
          </div>
        </form>

        {!ready && <div className="kiosk-message neutral">Connecting to Firebase…</div>}
        {busy && <div className="kiosk-message neutral">Recording attendance…</div>}
        {error && <div className="kiosk-message error">{error}</div>}
        {success && (
          <div className="kiosk-message success">
            <strong>{success.action === "IN" ? "Time In Recorded" : "Time Out Recorded"}</strong>
            <span>{success.name}</span>
          </div>
        )}

        <footer className="kiosk-footer">
          <span>Use only your assigned employee number.</span>
          <a href="/admin/login">Admin</a>
        </footer>
      </section>
    </main>
  );
}
