"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import type { User } from "firebase/auth";
import { signOut } from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import AdminGate from "@/components/AdminGate";
import { getFirebaseServices } from "@/lib/firebase";
import { friendlyFirebaseError } from "@/lib/errors";
import type { Employee, Shift } from "@/lib/types";
import {
  dateRange,
  durationMinutes,
  formatDateTime,
  formatDuration,
  hoursFromMinutes,
  monthStartInputValue,
  todayInputValue
} from "@/lib/time";

type Tab = "overview" | "employees" | "reports" | "qr";

function mapEmployee(id: string, data: Record<string, unknown>): Employee {
  return {
    id,
    employeeNumber: String(data.employeeNumber ?? id),
    name: String(data.name ?? "Unnamed Employee"),
    active: Boolean(data.active),
    activeShiftId: data.activeShiftId ? String(data.activeShiftId) : null,
    createdAt: (data.createdAt as Employee["createdAt"]) ?? null,
    lastActionAt: (data.lastActionAt as Employee["lastActionAt"]) ?? null
  };
}

function mapShift(id: string, data: Record<string, unknown>): Shift {
  return {
    id,
    employeeId: String(data.employeeId ?? ""),
    employeeNumber: String(data.employeeNumber ?? ""),
    employeeName: String(data.employeeName ?? "Unknown Employee"),
    status: data.status === "CLOSED" ? "CLOSED" : "OPEN",
    timeIn: (data.timeIn as Shift["timeIn"]) ?? null,
    timeOut: (data.timeOut as Shift["timeOut"]) ?? null,
    kioskUserId: String(data.kioskUserId ?? ""),
    createdAt: (data.createdAt as Shift["createdAt"]) ?? null,
    updatedAt: (data.updatedAt as Shift["updatedAt"]) ?? null
  };
}

function Dashboard({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [todayShifts, setTodayShifts] = useState<Shift[]>([]);
  const [reportShifts, setReportShifts] = useState<Shift[]>([]);
  const [reportStart, setReportStart] = useState(monthStartInputValue());
  const [reportEnd, setReportEnd] = useState(todayInputValue());
  const [employeeName, setEmployeeName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const [kioskUrl, setKioskUrl] = useState("");

  useEffect(() => {
    setKioskUrl(
      `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/kiosk`
    );
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const { db } = getFirebaseServices();
    const employeeQuery = query(collection(db, "employees"), orderBy("name", "asc"));

    const unsubscribeEmployees = onSnapshot(
      employeeQuery,
      (snapshot) => {
        setEmployees(snapshot.docs.map((item) => mapEmployee(item.id, item.data())));
      },
      (snapshotError) => setError(friendlyFirebaseError(snapshotError))
    );

    const today = todayInputValue();
    const range = dateRange(today, today);
    const shiftQuery = query(
      collection(db, "shifts"),
      where("timeIn", ">=", Timestamp.fromDate(range.start)),
      where("timeIn", "<=", Timestamp.fromDate(range.end)),
      orderBy("timeIn", "desc")
    );

    const unsubscribeShifts = onSnapshot(
      shiftQuery,
      (snapshot) => {
        setTodayShifts(snapshot.docs.map((item) => mapShift(item.id, item.data())));
      },
      (snapshotError) => setError(friendlyFirebaseError(snapshotError))
    );

    return () => {
      unsubscribeEmployees();
      unsubscribeShifts();
    };
  }, []);

  const activeEmployees = employees.filter((employee) => employee.active);
  const clockedInEmployees = employees.filter((employee) => employee.activeShiftId);
  const todayMinutes = todayShifts.reduce(
    (sum, shift) => sum + durationMinutes(shift.timeIn, shift.timeOut, now),
    0
  );

  const reportSummary = useMemo(() => {
    const summary = new Map<
      string,
      { employeeNumber: string; employeeName: string; shifts: number; minutes: number }
    >();

    for (const shift of reportShifts) {
      const existing = summary.get(shift.employeeId) ?? {
        employeeNumber: shift.employeeNumber,
        employeeName: shift.employeeName,
        shifts: 0,
        minutes: 0
      };

      existing.shifts += 1;
      existing.minutes += durationMinutes(shift.timeIn, shift.timeOut, now);
      summary.set(shift.employeeId, existing);
    }

    return Array.from(summary.values()).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName)
    );
  }, [reportShifts, now]);

  const loadReport = useCallback(async () => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const { db } = getFirebaseServices();
      const range = dateRange(reportStart, reportEnd);
      const reportQuery = query(
        collection(db, "shifts"),
        where("timeIn", ">=", Timestamp.fromDate(range.start)),
        where("timeIn", "<=", Timestamp.fromDate(range.end)),
        orderBy("timeIn", "asc")
      );

      const snapshot = await getDocs(reportQuery);
      setReportShifts(snapshot.docs.map((item) => mapShift(item.id, item.data())));
      setMessage(`Loaded ${snapshot.size} shift record${snapshot.size === 1 ? "" : "s"}.`);
    } catch (reportError) {
      setError(friendlyFirebaseError(reportError));
    } finally {
      setBusy(false);
    }
  }, [reportStart, reportEnd]);

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    const code = employeeNumber.trim();
    const name = employeeName.trim();

    if (!/^\d{4}$/.test(code)) {
      setError("Employee number must contain exactly four digits.");
      setBusy(false);
      return;
    }

    if (!name) {
      setError("Enter the employee name.");
      setBusy(false);
      return;
    }

    try {
      const { db } = getFirebaseServices();
      const employeeRef = doc(db, "employees", code);
      const existing = await getDoc(employeeRef);

      if (existing.exists()) {
        setError("That four-digit employee number is already assigned.");
        return;
      }

      await setDoc(employeeRef, {
        employeeNumber: code,
        name,
        active: true,
        activeShiftId: null,
        createdAt: serverTimestamp(),
        lastActionAt: null
      });

      setEmployeeName("");
      setEmployeeNumber("");
      setMessage(`${name} was added successfully.`);
    } catch (addError) {
      setError(friendlyFirebaseError(addError));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEmployee(employee: Employee) {
    setError("");
    setMessage("");

    if (employee.activeShiftId && employee.active) {
      setError("Clock this employee out before deactivating the account.");
      return;
    }

    try {
      const { db } = getFirebaseServices();
      await updateDoc(doc(db, "employees", employee.id), {
        active: !employee.active
      });
      setMessage(`${employee.name} is now ${employee.active ? "inactive" : "active"}.`);
    } catch (toggleError) {
      setError(friendlyFirebaseError(toggleError));
    }
  }

  async function removeEmployee(employee: Employee) {
    if (employee.activeShiftId) {
      setError("Clock this employee out before deleting the record.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${employee.name}? Existing shift records will remain in reports.`
    );
    if (!confirmed) return;

    try {
      const { db } = getFirebaseServices();
      await deleteDoc(doc(db, "employees", employee.id));
      setMessage(`${employee.name} was deleted.`);
    } catch (deleteError) {
      setError(friendlyFirebaseError(deleteError));
    }
  }

  async function exportExcel() {
    if (reportShifts.length === 0) {
      setError("Load a report before exporting to Excel.");
      return;
    }

    setError("");

    const XLSX = await import("xlsx");
    const detailRows = reportShifts.map((shift) => {
      const minutes = durationMinutes(shift.timeIn, shift.timeOut, now);
      return {
        "Employee Number": shift.employeeNumber,
        "Employee Name": shift.employeeName,
        "Time In": formatDateTime(shift.timeIn),
        "Time Out": shift.status === "OPEN" ? "Still Clocked In" : formatDateTime(shift.timeOut),
        Status: shift.status,
        "Total Minutes": minutes,
        "Total Hours": hoursFromMinutes(minutes)
      };
    });

    const summaryRows = reportSummary.map((item) => ({
      "Employee Number": item.employeeNumber,
      "Employee Name": item.employeeName,
      Shifts: item.shifts,
      "Total Minutes": item.minutes,
      "Total Hours": hoursFromMinutes(item.minutes)
    }));

    const workbook = XLSX.utils.book_new();
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);

    detailSheet["!cols"] = [
      { wch: 18 },
      { wch: 26 },
      { wch: 24 },
      { wch: 24 },
      { wch: 14 },
      { wch: 15 },
      { wch: 14 }
    ];
    summarySheet["!cols"] = [
      { wch: 18 },
      { wch: 26 },
      { wch: 10 },
      { wch: 15 },
      { wch: 14 }
    ];

    XLSX.utils.book_append_sheet(workbook, detailSheet, "Shift Details");
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Employee Summary");
    XLSX.writeFile(workbook, `employee-hours-${reportStart}-to-${reportEnd}.xlsx`);
  }

  async function logout() {
    const { auth } = getFirebaseServices();
    await signOut(auth);
    window.location.href = "/admin/login";
  }

  function printQr() {
    window.print();
  }

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div>
          <div className="sidebar-brand">
            <div className="brand-mark">TC</div>
            <div>
              <strong>Time Clock</strong>
              <span>Administration</span>
            </div>
          </div>

          <nav className="nav-list" aria-label="Dashboard sections">
            <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
            <button className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}>Employees</button>
            <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>Reports</button>
            <button className={tab === "qr" ? "active" : ""} onClick={() => setTab("qr")}>Station QR Code</button>
          </nav>
        </div>

        <div className="sidebar-user">
          <span>{user.email}</span>
          <button onClick={logout}>Sign Out</button>
        </div>
      </aside>

      <section className="admin-content">
        <header className="content-header">
          <div>
            <p className="eyebrow">EMPLOYEE ATTENDANCE</p>
            <h1>{tab === "overview" ? "Dashboard" : tab === "employees" ? "Employee Management" : tab === "reports" ? "Hours & Reports" : "Station QR Code"}</h1>
          </div>
          <a className="button secondary compact" href="/kiosk" target="_blank" rel="noreferrer">Open Clock</a>
        </header>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        {tab === "overview" && (
          <>
            <section className="metric-grid">
              <article className="metric-card"><span>Active Employees</span><strong>{activeEmployees.length}</strong></article>
              <article className="metric-card"><span>Currently Clocked In</span><strong>{clockedInEmployees.length}</strong></article>
              <article className="metric-card"><span>Shifts Today</span><strong>{todayShifts.length}</strong></article>
              <article className="metric-card"><span>Total Hours Today</span><strong>{hoursFromMinutes(todayMinutes).toFixed(2)}</strong></article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div><h2>Currently Clocked In</h2><p>Employees with an open shift.</p></div>
                <span className="status-pill open">{clockedInEmployees.length} Open</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee #</th><th>Name</th><th>Status</th><th>Last Action</th></tr></thead>
                  <tbody>
                    {clockedInEmployees.length === 0 ? (
                      <tr><td colSpan={4} className="empty-cell">No employees are currently clocked in.</td></tr>
                    ) : clockedInEmployees.map((employee) => (
                      <tr key={employee.id}>
                        <td>{employee.employeeNumber}</td>
                        <td><strong>{employee.name}</strong></td>
                        <td><span className="status-pill open">Clocked In</span></td>
                        <td>{formatDateTime(employee.lastActionAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Today&apos;s Activity</h2><p>Most recent attendance records.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Time In</th><th>Time Out</th><th>Duration</th><th>Status</th></tr></thead>
                  <tbody>
                    {todayShifts.length === 0 ? (
                      <tr><td colSpan={5} className="empty-cell">No shifts recorded today.</td></tr>
                    ) : todayShifts.map((shift) => (
                      <tr key={shift.id}>
                        <td><strong>{shift.employeeName}</strong><small>#{shift.employeeNumber}</small></td>
                        <td>{formatDateTime(shift.timeIn)}</td>
                        <td>{shift.status === "OPEN" ? "—" : formatDateTime(shift.timeOut)}</td>
                        <td>{formatDuration(durationMinutes(shift.timeIn, shift.timeOut, now))}</td>
                        <td><span className={`status-pill ${shift.status === "OPEN" ? "open" : "closed"}`}>{shift.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === "employees" && (
          <div className="two-column">
            <section className="panel form-panel">
              <div className="panel-heading"><div><h2>Add Employee</h2><p>Assign a unique four-digit employee number.</p></div></div>
              <form className="stack-form" onSubmit={addEmployee}>
                <label>Employee name<input value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} placeholder="Full name" required /></label>
                <label>Four-digit number<input value={employeeNumber} onChange={(event) => setEmployeeNumber(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0000" maxLength={4} required /></label>
                <button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : "Add Employee"}</button>
              </form>
            </section>

            <section className="panel employee-panel">
              <div className="panel-heading"><div><h2>Employee List</h2><p>{employees.length} employee record{employees.length === 1 ? "" : "s"}.</p></div></div>
              <div className="employee-list">
                {employees.length === 0 ? <div className="empty-state">No employees have been added.</div> : employees.map((employee) => (
                  <article className="employee-row" key={employee.id}>
                    <div className="employee-avatar">{employee.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
                    <div className="employee-main"><strong>{employee.name}</strong><span>Employee #{employee.employeeNumber}</span></div>
                    <span className={`status-pill ${employee.active ? "active" : "inactive"}`}>{employee.active ? "Active" : "Inactive"}</span>
                    <div className="row-actions">
                      <button onClick={() => toggleEmployee(employee)}>{employee.active ? "Deactivate" : "Activate"}</button>
                      <button className="danger-link" onClick={() => removeEmployee(employee)}>Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "reports" && (
          <>
            <section className="panel report-controls">
              <div className="panel-heading"><div><h2>Attendance Report</h2><p>Select a date range, then calculate and export employee hours.</p></div></div>
              <div className="report-form">
                <label>Start date<input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label>
                <label>End date<input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label>
                <button className="button primary" disabled={busy} onClick={loadReport}>{busy ? "Loading…" : "Run Report"}</button>
                <button className="button secondary" onClick={exportExcel}>Export Excel</button>
              </div>
            </section>

            <section className="metric-grid report-metrics">
              <article className="metric-card"><span>Employees</span><strong>{reportSummary.length}</strong></article>
              <article className="metric-card"><span>Shift Records</span><strong>{reportShifts.length}</strong></article>
              <article className="metric-card"><span>Total Hours</span><strong>{hoursFromMinutes(reportSummary.reduce((sum, item) => sum + item.minutes, 0)).toFixed(2)}</strong></article>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Hours by Employee</h2><p>Calculated from recorded Time In and Time Out timestamps.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee #</th><th>Name</th><th>Shifts</th><th>Total Time</th><th>Total Hours</th></tr></thead>
                  <tbody>
                    {reportSummary.length === 0 ? (
                      <tr><td colSpan={5} className="empty-cell">Run a report to view employee totals.</td></tr>
                    ) : reportSummary.map((item) => (
                      <tr key={item.employeeNumber}>
                        <td>{item.employeeNumber}</td><td><strong>{item.employeeName}</strong></td><td>{item.shifts}</td><td>{formatDuration(item.minutes)}</td><td>{hoursFromMinutes(item.minutes).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Shift Details</h2><p>Individual clock-in and clock-out records.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Time In</th><th>Time Out</th><th>Duration</th><th>Status</th></tr></thead>
                  <tbody>
                    {reportShifts.length === 0 ? (
                      <tr><td colSpan={5} className="empty-cell">No report data loaded.</td></tr>
                    ) : reportShifts.map((shift) => (
                      <tr key={shift.id}>
                        <td><strong>{shift.employeeName}</strong><small>#{shift.employeeNumber}</small></td>
                        <td>{formatDateTime(shift.timeIn)}</td>
                        <td>{shift.status === "OPEN" ? "Still Clocked In" : formatDateTime(shift.timeOut)}</td>
                        <td>{formatDuration(durationMinutes(shift.timeIn, shift.timeOut, now))}</td>
                        <td><span className={`status-pill ${shift.status === "OPEN" ? "open" : "closed"}`}>{shift.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === "qr" && (
          <section className="panel qr-panel">
            <div className="qr-copy">
              <p className="eyebrow">STATIONARY QR CODE</p>
              <h2>Employee Time Clock</h2>
              <p>Print and post this QR code at the attendance station. Employees scan it, enter their four-digit number, then choose Time In or Time Out.</p>
              <div className="url-box">{kioskUrl || "Preparing URL…"}</div>
              <button className="button primary" onClick={printQr}>Print QR Sign</button>
            </div>
            <div className="qr-print-card">
              <div className="brand-mark large">TC</div>
              <h2>Employee Time Clock</h2>
              <p>Scan to record your Time In or Time Out</p>
              {kioskUrl && <QRCodeSVG value={kioskUrl} size={280} level="H" includeMargin />}
              <strong>Enter your four-digit employee number</strong>
              <small>{kioskUrl}</small>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

export default function AdminPage() {
  return <AdminGate>{(user) => <Dashboard user={user} />}</AdminGate>;
}
