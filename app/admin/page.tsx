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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import AdminGate from "@/components/AdminGate";
import { getFirebaseServices } from "@/lib/firebase";
import { friendlyFirebaseError } from "@/lib/errors";
import type { Employee, EntryType, Shift } from "@/lib/types";
import {
  addDaysInputValue,
  dateKeyFromTimestamp,
  dateRange,
  durationMinutes,
  formatDateOnly,
  formatDateTime,
  formatDuration,
  hoursFromMinutes,
  monthStartInputValue,
  timestampToDateTimeLocalValue,
  todayInputValue,
  weekRangeSunday
} from "@/lib/time";

type Tab = "overview" | "employees" | "reports" | "weekly" | "qr";

type ReportSummaryRow = {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  entries: number;
  workMinutes: number;
  vacationMinutes: number;
  sickMinutes: number;
  totalMinutes: number;
};

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
  const rawEntryType = String(data.entryType ?? "WORK");
  const entryType: EntryType =
    rawEntryType === "VACATION" || rawEntryType === "SICK"
      ? rawEntryType
      : "WORK";

  return {
    id,
    employeeId: String(data.employeeId ?? ""),
    employeeNumber: String(data.employeeNumber ?? ""),
    employeeName: String(data.employeeName ?? "Unknown Employee"),
    entryType,
    status: data.status === "CLOSED" ? "CLOSED" : "OPEN",
    timeIn: (data.timeIn as Shift["timeIn"]) ?? null,
    timeOut: (data.timeOut as Shift["timeOut"]) ?? null,
    paidMinutes: Math.max(0, Number(data.paidMinutes ?? 0)),
    note: String(data.note ?? ""),
    source: data.source === "ADMIN" ? "ADMIN" : "KIOSK",
    kioskUserId: String(data.kioskUserId ?? ""),
    createdAt: (data.createdAt as Shift["createdAt"]) ?? null,
    updatedAt: (data.updatedAt as Shift["updatedAt"]) ?? null
  };
}

function entryLabel(entryType: EntryType): string {
  if (entryType === "VACATION") return "Vacation";
  if (entryType === "SICK") return "Sick";
  return "Work";
}

function entryMinutes(shift: Shift, now = new Date()): number {
  if (shift.entryType !== "WORK") return Math.max(0, shift.paidMinutes);
  return durationMinutes(shift.timeIn, shift.timeOut, now);
}

function dateTimeFromParts(dateValue: string, timeValue: string): Date {
  return new Date(`${dateValue}T${timeValue}`);
}

function absenceDate(dateValue: string): Date {
  return new Date(`${dateValue}T12:00:00`);
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

  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [editEntryType, setEditEntryType] = useState<EntryType>("WORK");
  const [editDate, setEditDate] = useState(todayInputValue());
  const [editTimeIn, setEditTimeIn] = useState("");
  const [editTimeOut, setEditTimeOut] = useState("");
  const [editPaidHours, setEditPaidHours] = useState("8");
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [manualEntryType, setManualEntryType] = useState<EntryType>("WORK");
  const [manualDate, setManualDate] = useState(todayInputValue());
  const [manualStartTime, setManualStartTime] = useState("08:00");
  const [manualEndTime, setManualEndTime] = useState("16:00");
  const [manualPaidHours, setManualPaidHours] = useState("8");
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const [weeklyEmployeeId, setWeeklyEmployeeId] = useState("");
  const [weekDate, setWeekDate] = useState(todayInputValue());
  const [weeklyShifts, setWeeklyShifts] = useState<Shift[]>([]);
  const [weeklyBusy, setWeeklyBusy] = useState(false);

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

  useEffect(() => {
    if (!weeklyEmployeeId && employees.length > 0) {
      setWeeklyEmployeeId(employees[0].id);
    }
    if (!manualEmployeeId && employees.length > 0) {
      setManualEmployeeId(employees[0].id);
    }
  }, [employees, manualEmployeeId, weeklyEmployeeId]);

  const activeEmployees = employees.filter((employee) => employee.active);
  const clockedInEmployees = employees.filter((employee) => employee.activeShiftId);
  const todayMinutes = todayShifts.reduce(
    (sum, shift) => sum + entryMinutes(shift, now),
    0
  );

  const reportSummary = useMemo<ReportSummaryRow[]>(() => {
    const summary = new Map<string, ReportSummaryRow>();

    for (const shift of reportShifts) {
      const minutes = entryMinutes(shift, now);
      const existing = summary.get(shift.employeeId) ?? {
        employeeId: shift.employeeId,
        employeeNumber: shift.employeeNumber,
        employeeName: shift.employeeName,
        entries: 0,
        workMinutes: 0,
        vacationMinutes: 0,
        sickMinutes: 0,
        totalMinutes: 0
      };

      existing.entries += 1;
      existing.totalMinutes += minutes;
      if (shift.entryType === "WORK") existing.workMinutes += minutes;
      if (shift.entryType === "VACATION") existing.vacationMinutes += minutes;
      if (shift.entryType === "SICK") existing.sickMinutes += minutes;
      summary.set(shift.employeeId, existing);
    }

    return Array.from(summary.values()).sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName)
    );
  }, [reportShifts, now]);

  const selectedWeeklyEmployee = employees.find(
    (employee) => employee.id === weeklyEmployeeId
  );
  const currentWeekRange = useMemo(
    () => weekRangeSunday(weekDate || todayInputValue()),
    [weekDate]
  );

  const weeklyDays = useMemo(() => {
    return currentWeekRange.days.map((day) => {
      const dayShifts = weeklyShifts.filter(
        (shift) => dateKeyFromTimestamp(shift.timeIn) === day.dateKey
      );
      const workMinutes = dayShifts
        .filter((shift) => shift.entryType === "WORK")
        .reduce((sum, shift) => sum + entryMinutes(shift, now), 0);
      const vacationMinutes = dayShifts
        .filter((shift) => shift.entryType === "VACATION")
        .reduce((sum, shift) => sum + entryMinutes(shift, now), 0);
      const sickMinutes = dayShifts
        .filter((shift) => shift.entryType === "SICK")
        .reduce((sum, shift) => sum + entryMinutes(shift, now), 0);

      return {
        ...day,
        shifts: dayShifts,
        workMinutes,
        vacationMinutes,
        sickMinutes,
        minutes: workMinutes + vacationMinutes + sickMinutes
      };
    });
  }, [currentWeekRange.days, weeklyShifts, now]);

  const weeklyWorkMinutes = weeklyDays.reduce(
    (sum, day) => sum + day.workMinutes,
    0
  );
  const weeklyVacationMinutes = weeklyDays.reduce(
    (sum, day) => sum + day.vacationMinutes,
    0
  );
  const weeklySickMinutes = weeklyDays.reduce(
    (sum, day) => sum + day.sickMinutes,
    0
  );
  const weeklyMinutes =
    weeklyWorkMinutes + weeklyVacationMinutes + weeklySickMinutes;

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
      setMessage(`Loaded ${snapshot.size} timecard entr${snapshot.size === 1 ? "y" : "ies"}.`);
    } catch (reportError) {
      setError(friendlyFirebaseError(reportError));
    } finally {
      setBusy(false);
    }
  }, [reportStart, reportEnd]);

  const loadWeeklyView = useCallback(async () => {
    if (!weeklyEmployeeId) {
      setWeeklyShifts([]);
      return;
    }

    setWeeklyBusy(true);
    setError("");

    try {
      const { db } = getFirebaseServices();
      const range = weekRangeSunday(weekDate || todayInputValue());
      const weeklyQuery = query(
        collection(db, "shifts"),
        where("timeIn", ">=", Timestamp.fromDate(range.start)),
        where("timeIn", "<=", Timestamp.fromDate(range.end)),
        orderBy("timeIn", "asc")
      );

      const snapshot = await getDocs(weeklyQuery);
      setWeeklyShifts(
        snapshot.docs
          .map((item) => mapShift(item.id, item.data()))
          .filter((shift) => shift.employeeId === weeklyEmployeeId)
      );
    } catch (weeklyError) {
      setError(friendlyFirebaseError(weeklyError));
    } finally {
      setWeeklyBusy(false);
    }
  }, [weekDate, weeklyEmployeeId]);

  useEffect(() => {
    if (tab === "weekly") {
      void loadWeeklyView();
    }
  }, [tab, loadWeeklyView]);

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
      `Delete ${employee.name}? Existing timecard records will remain in reports.`
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

  function openManualEntry(dateValue?: string, employeeId?: string) {
    setError("");
    setMessage("");
    setManualEmployeeId(employeeId || weeklyEmployeeId || employees[0]?.id || "");
    setManualEntryType("WORK");
    setManualDate(dateValue || todayInputValue());
    setManualStartTime("08:00");
    setManualEndTime("16:00");
    setManualPaidHours("8");
    setManualNote("");
    setManualOpen(true);
  }

  async function saveManualEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const employee = employees.find((item) => item.id === manualEmployeeId);

    if (!employee) {
      setError("Choose an employee.");
      return;
    }

    if (!manualDate) {
      setError("Choose a date.");
      return;
    }

    let timeInDate: Date;
    let timeOutDate: Date | null = null;
    let paidMinutes = 0;

    if (manualEntryType === "WORK") {
      timeInDate = dateTimeFromParts(manualDate, manualStartTime);
      timeOutDate = dateTimeFromParts(manualDate, manualEndTime);

      if (
        !manualStartTime ||
        !manualEndTime ||
        Number.isNaN(timeInDate.getTime()) ||
        Number.isNaN(timeOutDate.getTime())
      ) {
        setError("Enter valid start and end times.");
        return;
      }

      if (timeOutDate <= timeInDate) {
        // Warehouse night shifts can end after midnight. An end time that is
        // earlier than the start time is treated as the following day.
        timeOutDate.setDate(timeOutDate.getDate() + 1);
      }
    } else {
      timeInDate = absenceDate(manualDate);
      const hours = Number(manualPaidHours);

      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        setError("Absence hours must be between 0 and 24.");
        return;
      }

      paidMinutes = Math.round(hours * 60);
    }

    setManualBusy(true);
    setError("");
    setMessage("");

    try {
      const { db } = getFirebaseServices();
      const shiftRef = doc(collection(db, "shifts"));

      await setDoc(shiftRef, {
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        employeeName: employee.name,
        entryType: manualEntryType,
        status: "CLOSED",
        timeIn: Timestamp.fromDate(timeInDate),
        timeOut: timeOutDate ? Timestamp.fromDate(timeOutDate) : null,
        paidMinutes,
        note: manualNote.trim(),
        source: "ADMIN",
        kioskUserId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        editedBy: user.uid
      });

      setManualOpen(false);
      setMessage(
        `${entryLabel(manualEntryType)} entry added for ${employee.name}.`
      );

      if (tab === "reports") await loadReport();
      if (tab === "weekly") await loadWeeklyView();
    } catch (manualError) {
      setError(friendlyFirebaseError(manualError));
    } finally {
      setManualBusy(false);
    }
  }

  function openShiftEditor(shift: Shift) {
    setError("");
    setMessage("");
    setEditingShift(shift);
    setEditEntryType(shift.entryType);
    setEditDate(dateKeyFromTimestamp(shift.timeIn) || todayInputValue());
    setEditTimeIn(timestampToDateTimeLocalValue(shift.timeIn));
    setEditTimeOut(timestampToDateTimeLocalValue(shift.timeOut));
    setEditPaidHours((shift.paidMinutes / 60 || 8).toString());
    setEditNote(shift.note);
  }

  async function saveShiftEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingShift) return;

    let timeInDate: Date;
    let timeOutDate: Date | null = null;
    let paidMinutes = 0;
    let desiredStatus: "OPEN" | "CLOSED" = "CLOSED";

    if (editEntryType === "WORK") {
      timeInDate = new Date(editTimeIn);
      timeOutDate = editTimeOut ? new Date(editTimeOut) : null;
      desiredStatus = timeOutDate ? "CLOSED" : "OPEN";

      if (!editTimeIn || Number.isNaN(timeInDate.getTime())) {
        setError("Enter a valid Time In value.");
        return;
      }

      if (timeOutDate && Number.isNaN(timeOutDate.getTime())) {
        setError("Enter a valid Time Out value.");
        return;
      }

      if (timeOutDate && timeOutDate <= timeInDate) {
        setError("Time Out must be later than Time In.");
        return;
      }
    } else {
      timeInDate = absenceDate(editDate);
      const hours = Number(editPaidHours);

      if (!editDate || Number.isNaN(timeInDate.getTime())) {
        setError("Choose a valid absence date.");
        return;
      }

      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        setError("Absence hours must be between 0 and 24.");
        return;
      }

      paidMinutes = Math.round(hours * 60);
    }

    setEditBusy(true);
    setError("");
    setMessage("");

    try {
      const { db } = getFirebaseServices();
      const shiftRef = doc(db, "shifts", editingShift.id);
      const employeeRef = doc(db, "employees", editingShift.employeeId);

      await runTransaction(db, async (transaction) => {
        const [shiftSnapshot, employeeSnapshot] = await Promise.all([
          transaction.get(shiftRef),
          transaction.get(employeeRef)
        ]);

        if (!shiftSnapshot.exists()) {
          throw new Error("The timecard entry no longer exists.");
        }

        const employeeData = employeeSnapshot.exists()
          ? employeeSnapshot.data()
          : null;
        const currentActiveShiftId = employeeData?.activeShiftId
          ? String(employeeData.activeShiftId)
          : null;

        if (editEntryType === "WORK" && desiredStatus === "OPEN") {
          if (!employeeSnapshot.exists()) {
            throw new Error("The employee record no longer exists.");
          }

          if (currentActiveShiftId && currentActiveShiftId !== editingShift.id) {
            throw new Error(
              "This employee already has another open shift. Close that shift first."
            );
          }

          transaction.update(employeeRef, {
            activeShiftId: editingShift.id,
            lastActionAt: Timestamp.fromDate(timeInDate)
          });
        } else if (
          employeeSnapshot.exists() &&
          currentActiveShiftId === editingShift.id
        ) {
          transaction.update(employeeRef, {
            activeShiftId: null,
            lastActionAt: Timestamp.fromDate(timeOutDate ?? timeInDate)
          });
        }

        transaction.update(shiftRef, {
          entryType: editEntryType,
          timeIn: Timestamp.fromDate(timeInDate),
          timeOut: timeOutDate ? Timestamp.fromDate(timeOutDate) : null,
          paidMinutes,
          note: editNote.trim(),
          status: desiredStatus,
          source: "ADMIN",
          updatedAt: serverTimestamp(),
          editedAt: serverTimestamp(),
          editedBy: user.uid
        });
      });

      setEditingShift(null);
      setMessage(`${editingShift.employeeName}'s timecard was updated.`);

      if (tab === "reports") await loadReport();
      if (tab === "weekly") await loadWeeklyView();
    } catch (editError) {
      setError(friendlyFirebaseError(editError));
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteTimecardEntry() {
    if (!editingShift) return;

    const confirmed = window.confirm(
      `Delete this ${entryLabel(editingShift.entryType).toLowerCase()} entry for ${editingShift.employeeName}?`
    );
    if (!confirmed) return;

    setEditBusy(true);
    setError("");

    try {
      const { db } = getFirebaseServices();
      const shiftRef = doc(db, "shifts", editingShift.id);
      const employeeRef = doc(db, "employees", editingShift.employeeId);

      await runTransaction(db, async (transaction) => {
        const employeeSnapshot = await transaction.get(employeeRef);
        if (
          employeeSnapshot.exists() &&
          String(employeeSnapshot.data().activeShiftId ?? "") === editingShift.id
        ) {
          transaction.update(employeeRef, {
            activeShiftId: null,
            lastActionAt: serverTimestamp()
          });
        }
        transaction.delete(shiftRef);
      });

      setEditingShift(null);
      setMessage("Timecard entry deleted.");
      if (tab === "reports") await loadReport();
      if (tab === "weekly") await loadWeeklyView();
    } catch (deleteError) {
      setError(friendlyFirebaseError(deleteError));
    } finally {
      setEditBusy(false);
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
      const minutes = entryMinutes(shift, now);
      return {
        "Employee Number": shift.employeeNumber,
        "Employee Name": shift.employeeName,
        Date: dateKeyFromTimestamp(shift.timeIn),
        "Entry Type": entryLabel(shift.entryType),
        "Time In": shift.entryType === "WORK" ? formatDateTime(shift.timeIn) : "",
        "Time Out":
          shift.entryType !== "WORK"
            ? ""
            : shift.status === "OPEN"
              ? "Still Clocked In"
              : formatDateTime(shift.timeOut),
        Status: shift.status,
        Note: shift.note,
        "Total Minutes": minutes,
        "Total Hours": hoursFromMinutes(minutes)
      };
    });

    const summaryRows = reportSummary.map((item) => ({
      "Employee Number": item.employeeNumber,
      "Employee Name": item.employeeName,
      Entries: item.entries,
      "Work Hours": hoursFromMinutes(item.workMinutes),
      "Vacation Hours": hoursFromMinutes(item.vacationMinutes),
      "Sick Hours": hoursFromMinutes(item.sickMinutes),
      "Total Hours": hoursFromMinutes(item.totalMinutes)
    }));

    const workbook = XLSX.utils.book_new();
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);

    detailSheet["!cols"] = [
      { wch: 18 },
      { wch: 26 },
      { wch: 14 },
      { wch: 16 },
      { wch: 24 },
      { wch: 24 },
      { wch: 12 },
      { wch: 30 },
      { wch: 15 },
      { wch: 14 }
    ];
    summarySheet["!cols"] = [
      { wch: 18 },
      { wch: 26 },
      { wch: 10 },
      { wch: 14 },
      { wch: 16 },
      { wch: 12 },
      { wch: 14 }
    ];

    XLSX.utils.book_append_sheet(workbook, detailSheet, "Timecard Details");
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Employee Summary");
    XLSX.writeFile(workbook, `employee-hours-${reportStart}-to-${reportEnd}.xlsx`);
  }

  async function exportWeeklyExcel() {
    if (!selectedWeeklyEmployee) {
      setError("Choose an employee first.");
      return;
    }

    const XLSX = await import("xlsx");
    const dailyRows = weeklyDays.map((day) => ({
      Day: day.weekday,
      Date: day.dateKey,
      "Work Hours": hoursFromMinutes(day.workMinutes),
      "Vacation Hours": hoursFromMinutes(day.vacationMinutes),
      "Sick Hours": hoursFromMinutes(day.sickMinutes),
      "Total Hours": hoursFromMinutes(day.minutes)
    }));

    const shiftRows = weeklyShifts.map((shift) => {
      const minutes = entryMinutes(shift, now);
      return {
        Employee: shift.employeeName,
        "Employee Number": shift.employeeNumber,
        Date: dateKeyFromTimestamp(shift.timeIn),
        "Entry Type": entryLabel(shift.entryType),
        "Time In": shift.entryType === "WORK" ? formatDateTime(shift.timeIn) : "",
        "Time Out":
          shift.entryType === "WORK"
            ? shift.status === "OPEN"
              ? "Still Clocked In"
              : formatDateTime(shift.timeOut)
            : "",
        Note: shift.note,
        "Total Time": formatDuration(minutes),
        "Total Hours": hoursFromMinutes(minutes)
      };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(dailyRows),
      "Sunday-Saturday"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(shiftRows),
      "Timecard Details"
    );
    XLSX.writeFile(
      workbook,
      `${selectedWeeklyEmployee.employeeNumber}-${currentWeekRange.startDateKey}-to-${currentWeekRange.endDateKey}.xlsx`
    );
  }

  async function logout() {
    const { auth } = getFirebaseServices();
    await signOut(auth);
    window.location.href = "/admin/login";
  }

  function printQr() {
    window.print();
  }

  function pageTitle() {
    if (tab === "overview") return "Dashboard";
    if (tab === "employees") return "Employee Management";
    if (tab === "reports") return "Hours & Reports";
    if (tab === "weekly") return "Weekly Timecards";
    return "Station QR Code";
  }

  const editPreviewMinutes = useMemo(() => {
    if (editEntryType !== "WORK") {
      const hours = Number(editPaidHours);
      return Number.isFinite(hours) ? Math.max(0, Math.round(hours * 60)) : 0;
    }

    if (!editTimeIn) return 0;
    const start = new Date(editTimeIn);
    const end = editTimeOut ? new Date(editTimeOut) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }, [editEntryType, editPaidHours, editTimeIn, editTimeOut, now]);

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
            <button className={tab === "weekly" ? "active" : ""} onClick={() => setTab("weekly")}>Timecards</button>
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
            <h1>{pageTitle()}</h1>
          </div>
          <div className="content-header-actions">
            {tab !== "qr" && (
              <button className="button primary compact" onClick={() => openManualEntry()}>
                Add Timecard Entry
              </button>
            )}
            <a className="button secondary compact" href="/kiosk" target="_blank" rel="noreferrer">Open Clock</a>
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        {tab === "overview" && (
          <>
            <section className="metric-grid">
              <article className="metric-card"><span>Active Employees</span><strong>{activeEmployees.length}</strong></article>
              <article className="metric-card"><span>Currently Clocked In</span><strong>{clockedInEmployees.length}</strong></article>
              <article className="metric-card"><span>Entries Today</span><strong>{todayShifts.length}</strong></article>
              <article className="metric-card"><span>Total Hours Today</span><strong>{hoursFromMinutes(todayMinutes).toFixed(2)}</strong></article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div><h2>Currently Clocked In</h2><p>Employees with an open work shift.</p></div>
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
              <div className="panel-heading"><div><h2>Today&apos;s Timecard</h2><p>Work, vacation, and sick entries recorded today.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Type</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {todayShifts.length === 0 ? (
                      <tr><td colSpan={7} className="empty-cell">No timecard entries recorded today.</td></tr>
                    ) : todayShifts.map((shift) => (
                      <tr key={shift.id}>
                        <td><strong>{shift.employeeName}</strong><small>#{shift.employeeNumber}</small></td>
                        <td><span className={`entry-type-pill ${shift.entryType.toLowerCase()}`}>{entryLabel(shift.entryType)}</span></td>
                        <td>{shift.entryType === "WORK" ? formatDateTime(shift.timeIn) : "—"}</td>
                        <td>{shift.entryType !== "WORK" ? "—" : shift.status === "OPEN" ? "—" : formatDateTime(shift.timeOut)}</td>
                        <td>{hoursFromMinutes(entryMinutes(shift, now)).toFixed(2)}</td>
                        <td><span className={`status-pill ${shift.status === "OPEN" ? "open" : "closed"}`}>{shift.status}</span></td>
                        <td><button className="table-action" onClick={() => openShiftEditor(shift)}>Edit</button></td>
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
                      <button onClick={() => { setWeeklyEmployeeId(employee.id); setTab("weekly"); }}>Open Timecard</button>
                      <button onClick={() => openManualEntry(todayInputValue(), employee.id)}>Add Entry</button>
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
              <div className="panel-heading"><div><h2>Attendance Report</h2><p>Select a date range, calculate hours, edit records, and export to Excel.</p></div></div>
              <div className="report-form">
                <label>Start date<input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label>
                <label>End date<input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label>
                <button className="button primary" disabled={busy} onClick={loadReport}>{busy ? "Loading…" : "Run Report"}</button>
                <button className="button secondary" onClick={exportExcel}>Export Excel</button>
              </div>
            </section>

            <section className="metric-grid report-metrics">
              <article className="metric-card"><span>Employees</span><strong>{reportSummary.length}</strong></article>
              <article className="metric-card"><span>Timecard Entries</span><strong>{reportShifts.length}</strong></article>
              <article className="metric-card"><span>Total Hours</span><strong>{hoursFromMinutes(reportSummary.reduce((sum, item) => sum + item.totalMinutes, 0)).toFixed(2)}</strong></article>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Hours by Employee</h2><p>Work hours and credited vacation or sick hours.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Entries</th><th>Work</th><th>Vacation</th><th>Sick</th><th>Total</th><th>Timecard</th></tr></thead>
                  <tbody>
                    {reportSummary.length === 0 ? (
                      <tr><td colSpan={7} className="empty-cell">Run a report to view employee totals.</td></tr>
                    ) : reportSummary.map((item) => (
                      <tr key={item.employeeId}>
                        <td><strong>{item.employeeName}</strong><small>#{item.employeeNumber}</small></td>
                        <td>{item.entries}</td>
                        <td>{hoursFromMinutes(item.workMinutes).toFixed(2)}</td>
                        <td>{hoursFromMinutes(item.vacationMinutes).toFixed(2)}</td>
                        <td>{hoursFromMinutes(item.sickMinutes).toFixed(2)}</td>
                        <td><strong>{hoursFromMinutes(item.totalMinutes).toFixed(2)}</strong></td>
                        <td><button className="table-action" onClick={() => { setWeeklyEmployeeId(item.employeeId); setWeekDate(reportEnd); setTab("weekly"); }}>Open Week</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Timecard Details</h2><p>Edit work times, vacation, or sick entries.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Employee</th><th>Date</th><th>Type</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Note</th><th>Action</th></tr></thead>
                  <tbody>
                    {reportShifts.length === 0 ? (
                      <tr><td colSpan={8} className="empty-cell">No report data loaded.</td></tr>
                    ) : reportShifts.map((shift) => (
                      <tr key={shift.id}>
                        <td><strong>{shift.employeeName}</strong><small>#{shift.employeeNumber}</small></td>
                        <td>{dateKeyFromTimestamp(shift.timeIn)}</td>
                        <td><span className={`entry-type-pill ${shift.entryType.toLowerCase()}`}>{entryLabel(shift.entryType)}</span></td>
                        <td>{shift.entryType === "WORK" ? formatDateTime(shift.timeIn) : "—"}</td>
                        <td>{shift.entryType !== "WORK" ? "—" : shift.status === "OPEN" ? "Still Clocked In" : formatDateTime(shift.timeOut)}</td>
                        <td>{hoursFromMinutes(entryMinutes(shift, now)).toFixed(2)}</td>
                        <td className="note-cell">{shift.note || "—"}</td>
                        <td><button className="table-action" onClick={() => openShiftEditor(shift)}>Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === "weekly" && (
          <>
            <section className="panel weekly-controls">
              <div className="panel-heading">
                <div>
                  <h2>Sunday–Saturday Timecard</h2>
                  <p>Review, add, and edit work, vacation, and sick entries.</p>
                </div>
              </div>
              <div className="weekly-control-grid">
                <label>
                  Employee
                  <select value={weeklyEmployeeId} onChange={(event) => setWeeklyEmployeeId(event.target.value)}>
                    {employees.length === 0 && <option value="">No employees available</option>}
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} — #{employee.employeeNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date within week
                  <input type="date" value={weekDate} onChange={(event) => setWeekDate(event.target.value)} />
                </label>
                <div className="week-navigation">
                  <button className="button secondary compact" onClick={() => setWeekDate(addDaysInputValue(currentWeekRange.start, -7))}>Previous</button>
                  <button className="button secondary compact" onClick={() => setWeekDate(todayInputValue())}>Current Week</button>
                  <button className="button secondary compact" onClick={() => setWeekDate(addDaysInputValue(currentWeekRange.start, 7))}>Next</button>
                </div>
                <button className="button primary" disabled={weeklyBusy || !weeklyEmployeeId} onClick={loadWeeklyView}>{weeklyBusy ? "Loading…" : "Refresh Week"}</button>
                <button className="button secondary" disabled={!selectedWeeklyEmployee} onClick={exportWeeklyExcel}>Export Week</button>
              </div>
            </section>

            <section className="metric-grid weekly-metrics">
              <article className="metric-card"><span>Employee</span><strong className="metric-name">{selectedWeeklyEmployee?.name ?? "—"}</strong></article>
              <article className="metric-card"><span>Week</span><strong className="metric-date">{formatDateOnly(currentWeekRange.start)} – {formatDateOnly(currentWeekRange.end)}</strong></article>
              <article className="metric-card"><span>Work Hours</span><strong>{hoursFromMinutes(weeklyWorkMinutes).toFixed(2)}</strong></article>
              <article className="metric-card"><span>Vacation / Sick</span><strong>{hoursFromMinutes(weeklyVacationMinutes + weeklySickMinutes).toFixed(2)}</strong></article>
              <article className="metric-card"><span>Total Hours</span><strong>{hoursFromMinutes(weeklyMinutes).toFixed(2)}</strong></article>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Daily Timecard</h2><p>The workweek starts Sunday and ends Saturday.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Day</th><th>Date</th><th>Work</th><th>Vacation</th><th>Sick</th><th>Total</th><th>Action</th></tr></thead>
                  <tbody>
                    {weeklyDays.map((day) => (
                      <tr key={day.dateKey}>
                        <td><strong>{day.weekday}</strong></td>
                        <td>{formatDateOnly(day.date)}</td>
                        <td>{hoursFromMinutes(day.workMinutes).toFixed(2)}</td>
                        <td>{hoursFromMinutes(day.vacationMinutes).toFixed(2)}</td>
                        <td>{hoursFromMinutes(day.sickMinutes).toFixed(2)}</td>
                        <td><strong>{hoursFromMinutes(day.minutes).toFixed(2)}</strong></td>
                        <td><button className="table-action" onClick={() => openManualEntry(day.dateKey, weeklyEmployeeId)}>Add Entry</button></td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td colSpan={2}><strong>Weekly Total</strong></td>
                      <td><strong>{hoursFromMinutes(weeklyWorkMinutes).toFixed(2)}</strong></td>
                      <td><strong>{hoursFromMinutes(weeklyVacationMinutes).toFixed(2)}</strong></td>
                      <td><strong>{hoursFromMinutes(weeklySickMinutes).toFixed(2)}</strong></td>
                      <td><strong>{hoursFromMinutes(weeklyMinutes).toFixed(2)}</strong></td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Timecard Entry Details</h2><p>Edit or delete any entry directly from this page.</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Type</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Note</th><th>Action</th></tr></thead>
                  <tbody>
                    {weeklyShifts.length === 0 ? (
                      <tr><td colSpan={7} className="empty-cell">No timecard entries found for this employee during the selected week.</td></tr>
                    ) : weeklyShifts.map((shift) => (
                      <tr key={shift.id}>
                        <td>{dateKeyFromTimestamp(shift.timeIn)}</td>
                        <td><span className={`entry-type-pill ${shift.entryType.toLowerCase()}`}>{entryLabel(shift.entryType)}</span></td>
                        <td>{shift.entryType === "WORK" ? formatDateTime(shift.timeIn) : "—"}</td>
                        <td>{shift.entryType !== "WORK" ? "—" : shift.status === "OPEN" ? "Still Clocked In" : formatDateTime(shift.timeOut)}</td>
                        <td>{hoursFromMinutes(entryMinutes(shift, now)).toFixed(2)}</td>
                        <td className="note-cell">{shift.note || "—"}</td>
                        <td><button className="table-action" onClick={() => openShiftEditor(shift)}>Edit</button></td>
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

      {manualOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !manualBusy && setManualOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="manual-entry-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">ADMIN ENTRY</p>
                <h2 id="manual-entry-title">Add Timecard Entry</h2>
                <p>Enter work hours, vacation, or a sick day.</p>
              </div>
              <button className="modal-close" type="button" onClick={() => setManualOpen(false)} aria-label="Close">×</button>
            </div>

            <form className="edit-shift-form" onSubmit={saveManualEntry}>
              <div className="form-grid two">
                <label>
                  Employee
                  <select value={manualEmployeeId} onChange={(event) => setManualEmployeeId(event.target.value)} required>
                    <option value="">Select employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name} — #{employee.employeeNumber}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Entry type
                  <select value={manualEntryType} onChange={(event) => setManualEntryType(event.target.value as EntryType)}>
                    <option value="WORK">Work Hours</option>
                    <option value="VACATION">Vacation</option>
                    <option value="SICK">Called In Sick</option>
                  </select>
                </label>
              </div>

              <label>
                Date
                <input type="date" required value={manualDate} onChange={(event) => setManualDate(event.target.value)} />
              </label>

              {manualEntryType === "WORK" ? (
                <div className="form-grid two">
                  <label>Start time<input type="time" required value={manualStartTime} onChange={(event) => setManualStartTime(event.target.value)} /></label>
                  <label>End time<input type="time" required value={manualEndTime} onChange={(event) => setManualEndTime(event.target.value)} /></label>
                  <small className="grid-note">If the end time is earlier than the start time, it will be recorded as the following day.</small>
                </div>
              ) : (
                <label>
                  Hours credited
                  <input type="number" min="0" max="24" step="0.25" required value={manualPaidHours} onChange={(event) => setManualPaidHours(event.target.value)} />
                  <small>Use 8 for a full paid day, or 0 for an unpaid absence.</small>
                </label>
              )}

              <label>
                Note (optional)
                <textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Reason, approval, or payroll note" rows={3} />
              </label>

              <div className="modal-actions">
                <button className="button secondary" type="button" disabled={manualBusy} onClick={() => setManualOpen(false)}>Cancel</button>
                <button className="button primary" type="submit" disabled={manualBusy}>{manualBusy ? "Saving…" : "Save Entry"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editingShift && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !editBusy && setEditingShift(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-shift-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">EDIT TIMECARD</p>
                <h2 id="edit-shift-title">{editingShift.employeeName}</h2>
                <p>Employee #{editingShift.employeeNumber}</p>
              </div>
              <button className="modal-close" type="button" onClick={() => setEditingShift(null)} aria-label="Close">×</button>
            </div>

            <form className="edit-shift-form" onSubmit={saveShiftEdit}>
              <label>
                Entry type
                <select value={editEntryType} onChange={(event) => setEditEntryType(event.target.value as EntryType)}>
                  <option value="WORK">Work Hours</option>
                  <option value="VACATION">Vacation</option>
                  <option value="SICK">Called In Sick</option>
                </select>
              </label>

              {editEntryType === "WORK" ? (
                <>
                  <label>
                    Time In
                    <input type="datetime-local" required value={editTimeIn} onChange={(event) => setEditTimeIn(event.target.value)} />
                  </label>
                  <label>
                    Time Out
                    <input type="datetime-local" value={editTimeOut} onChange={(event) => setEditTimeOut(event.target.value)} />
                  </label>
                </>
              ) : (
                <div className="form-grid two">
                  <label>
                    Date
                    <input type="date" required value={editDate} onChange={(event) => setEditDate(event.target.value)} />
                  </label>
                  <label>
                    Hours credited
                    <input type="number" min="0" max="24" step="0.25" required value={editPaidHours} onChange={(event) => setEditPaidHours(event.target.value)} />
                  </label>
                </div>
              )}

              <label>
                Note (optional)
                <textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} placeholder="Reason, approval, or payroll note" rows={3} />
              </label>

              <div className="edit-preview">
                <span>Calculated total</span>
                <strong>{formatDuration(editPreviewMinutes)} ({hoursFromMinutes(editPreviewMinutes).toFixed(2)} hours)</strong>
              </div>

              {editEntryType === "WORK" && (
                <p className="form-note">Leave Time Out blank only when the employee should remain clocked in. Saving a Time Out closes the shift automatically.</p>
              )}

              <div className="modal-actions split-actions">
                <button className="button danger-button" type="button" disabled={editBusy} onClick={deleteTimecardEntry}>Delete Entry</button>
                <div>
                  <button className="button secondary" type="button" disabled={editBusy} onClick={() => setEditingShift(null)}>Cancel</button>
                  <button className="button primary" type="submit" disabled={editBusy}>{editBusy ? "Updating…" : "Update Timecard"}</button>
                </div>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export default function AdminPage() {
  return <AdminGate>{(user) => <Dashboard user={user} />}</AdminGate>;
}
