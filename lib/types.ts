import type { Timestamp } from "firebase/firestore";

export type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
  active: boolean;
  activeShiftId: string | null;
  createdAt?: Timestamp | null;
  lastActionAt?: Timestamp | null;
};

export type Shift = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  status: "OPEN" | "CLOSED";
  timeIn: Timestamp | null;
  timeOut: Timestamp | null;
  kioskUserId: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

export type AdminProfile = {
  role: "admin";
  name?: string;
  email?: string;
};
