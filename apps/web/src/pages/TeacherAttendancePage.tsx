import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crosshair,
  FileEdit,
  FilePlus2,
  History,
  LayoutGrid,
  List,
  LockKeyhole,
  MapPin,
  Navigation,
  PieChart,
  RefreshCw,
  Rows3,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  X
} from "lucide-react";
import LeavePage from "./LeavePage";

type RequestWithAuth = <T>(path: string, options: RequestInit) => Promise<T>;

type AttendanceRecord = {
  _id: string;
  attendanceDate: string;
  checkInAtServer?: string;
  status: "on_time" | "late" | "on_leave" | "corrected";
  correctedToStatus?: "on_time" | "late" | "on_leave";
  distanceMeters?: number;
};

type Settings = {
  enabled: boolean;
  geofenceCenterLat: number;
  geofenceCenterLng: number;
  geofenceRadiusMeters: number;
  boundaryToleranceMeters: number;
  markWindowStart: string;
  markWindowEnd: string;
  inTimeThreshold: string;
  maxLocationAccuracyMeters: number | null;
  pinMinLength: number;
  pinNumericOnly: boolean;
  correctionWindowHours: number;
  allowAdminBackdateCorrection: boolean;
};

type OverviewRow = {
  teacherId: string;
  teacherName: string;
  className: string;
  attendanceDate: string;
  status: string;
  record?: AttendanceRecord;
};

type AttendanceRequestItem = {
  _id: string;
  teacherId: string;
  teacherName: string;
  className: string;
  attendanceDate: string;
  requestType: "correction" | "manual";
  requestedStatus: "on_time" | "late" | "on_leave";
  reason: string;
  status: "pending" | "approved" | "rejected";
  decisionNote?: string;
  existingRecordId?: string;
  createdAt: string;
};

type ClassItem = { _id: string; name: string };
type TeacherItem = { _id: string; fullName: string };

type ViewMode = "calendar" | "tile" | "list";
type TabKey = "self" | "view" | "summary" | "requests" | "settings" | "leave";

const VIEW_MODE_KEY = "sams_teacher_attendance_view_mode";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function currentMonthKey() {
  return todayKey().slice(0, 7);
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatMonthLabel(monthKey: string) {
  return new Date(`${monthKey}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatTime(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function statusTone(status: string) {
  if (status === "on_time" || status === "corrected") return "present";
  if (status === "late") return "late";
  if (status === "missed") return "absent";
  if (status === "on_leave") return "half_day";
  return "default";
}

function requestStatusTone(status: string) {
  if (status === "approved") return "leave-approved";
  if (status === "rejected") return "leave-rejected";
  return "leave-pending";
}

function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    daysInMonth,
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(daysInMonth).padStart(2, "0")}`
  };
}

function shiftMonth(monthKey: string, delta: number) {
  const { year, month } = monthBounds(monthKey);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarCells(monthKey: string): (string | null)[] {
  const { year, month, daysInMonth } = monthBounds(monthKey);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  return cells;
}

function geolocationErrorCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

function isPermissionDenied(error: unknown): boolean {
  return geolocationErrorCode(error) === 1;
}

function isTimeout(error: unknown): boolean {
  return geolocationErrorCode(error) === 3;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function TeacherAttendancePage({
  requestWithAuth,
  isAdmin,
  initialTab
}: {
  requestWithAuth: RequestWithAuth;
  isAdmin: boolean;
  initialTab?: TabKey;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? (isAdmin ? "view" : "self"));
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [myRequests, setMyRequests] = useState<AttendanceRequestItem[]>([]);
  const [adminRequests, setAdminRequests] = useState<AttendanceRequestItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "capturing" | "captured" | "error" | "out_of_range">("idle");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [capturedLocation, setCapturedLocation] = useState<GeolocationPosition | null>(null);
  const [hasStartedAutoCapture, setHasStartedAutoCapture] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? "list"
  );
  const [viewMonth, setViewMonth] = useState<string>(currentMonthKey());
  const [filterClassId, setFilterClassId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [requestModal, setRequestModal] = useState<{ type: "correction" | "manual"; date: string; existingRecordId?: string } | null>(null);
  const [requestStatusValue, setRequestStatusValue] = useState<"on_time" | "late" | "on_leave">("on_time");
  const [requestReason, setRequestReason] = useState("");
  const [requestSaving, setRequestSaving] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ requestId: string; teacherName: string; date: string } | null>(null);
  const [decisionNoteValue, setDecisionNoteValue] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  useEffect(() => {
    // The "self" tab is teacher-only; "requests"/"settings" are admin-only. Role can change without remounting this page.
    setActiveTab((current) => {
      if (isAdmin && current === "self") return "view";
      if (!isAdmin && (current === "requests" || current === "settings")) return "view";
      return current;
    });
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = monthBounds(viewMonth);
      if (isAdmin) {
        const params = new URLSearchParams({ from, to });
        if (filterClassId) params.set("classId", filterClassId);
        if (filterTeacherId) params.set("teacherId", filterTeacherId);
        const [result, policy, pending] = await Promise.all([
          requestWithAuth<{ rows: OverviewRow[] }>(`/teacher-attendance/admin/overview?${params.toString()}`, { method: "GET" }),
          requestWithAuth<Settings>("/teacher-attendance/settings", { method: "GET" }),
          requestWithAuth<{ items: AttendanceRequestItem[] }>("/teacher-attendance/admin/requests?pageSize=100", { method: "GET" })
        ]);
        setOverview(result.rows);
        setSettings(policy);
        setAdminRequests(pending.items);
      } else {
        const [result, myPending] = await Promise.all([
          requestWithAuth<{ items: AttendanceRecord[] }>(`/teacher-attendance/me?from=${from}&to=${to}&pageSize=100`, { method: "GET" }),
          requestWithAuth<{ items: AttendanceRequestItem[] }>("/teacher-attendance/requests/me?pageSize=100", { method: "GET" })
        ]);
        setRecords(result.items);
        setMyRequests(myPending.items);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("teacherAttendance.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, requestWithAuth, t, viewMonth, filterClassId, filterTeacherId]);

  useEffect(() => {
    void load();
    if (isAdmin) return;
    void requestWithAuth<Settings>("/teacher-attendance/settings", { method: "GET" }).then(setSettings).catch(() => undefined);
  }, [isAdmin, load, requestWithAuth]);

  useEffect(() => {
    if (!isAdmin) return;
    void requestWithAuth<{ items: ClassItem[] }>("/master-data/classes?active=true&pageSize=200", { method: "GET" }).then((res) => setClasses(res.items)).catch(() => undefined);
    void requestWithAuth<{ items: TeacherItem[] }>("/master-data/teachers?pageSize=200", { method: "GET" }).then((res) => setTeachers(res.items)).catch(() => undefined);
  }, [isAdmin, requestWithAuth]);

  const isCheckedInToday = records.some((record) => record.attendanceDate === todayKey());

  useEffect(() => {
    if (isAdmin || loading || hasStartedAutoCapture) return;
    if (!settings) return;
    if (isCheckedInToday) return;
    setHasStartedAutoCapture(true);
    void captureLocation(settings).catch(() => undefined);
  }, [isAdmin, loading, settings, hasStartedAutoCapture, isCheckedInToday]);

  const captureLocation = async (currentSettings = settings) => {
    setError(null);
    try {
      setLocationStatus("capturing");
      if (!navigator.geolocation) {
        setLocationDenied(false);
        throw new Error(t("teacherAttendance.locationNotSupported"));
      }
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
      });
      setLocationDenied(false);
      setLocationAccuracy(position.coords.accuracy);

      if (currentSettings) {
        const distance = haversineMeters(
          currentSettings.geofenceCenterLat,
          currentSettings.geofenceCenterLng,
          position.coords.latitude,
          position.coords.longitude
        );
        if (distance > currentSettings.geofenceRadiusMeters + currentSettings.boundaryToleranceMeters) {
          setLocationStatus("out_of_range");
          setCapturedLocation(position);
          return position;
        }
      }

      setLocationStatus("captured");
      setCapturedLocation(position);
      return position;
    } catch (locationError) {
      const denied = isPermissionDenied(locationError);
      setLocationDenied(denied);
      setLocationStatus("error");
      setCapturedLocation(null);
      setError(
        denied ? t("teacherAttendance.locationDenied")
          : isTimeout(locationError) ? t("teacherAttendance.locationTimeout")
            : locationError instanceof Error && locationError.message ? locationError.message
              : t("teacherAttendance.locationUnavailable")
      );
      throw locationError;
    }
  };

  const markAttendance = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const position = capturedLocation ?? await captureLocation(settings);
      await requestWithAuth("/teacher-attendance/mark", {
        method: "POST",
        body: JSON.stringify({
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString()
          }
        })
      });
      setNotice(t("teacherAttendance.markedSuccess"));
      await load();
    } catch (markError) {
      const geoFailure = geolocationErrorCode(markError) !== null;
      if (geoFailure) {
        // captureLocation already set status, denied flag, and a specific message.
        return;
      }
      setLocationStatus("idle");
      setCapturedLocation(null);
      const message = markError instanceof Error ? markError.message : t("teacherAttendance.markFailed");
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const captureSchoolLocation = async () => {
    setError(null);
    setNotice(null);
    try {
      const position = await captureLocation(null);
      setLocationAccuracy(position.coords.accuracy);
      setLocationStatus("captured");
      setSettings((current) => current ? {
        ...current,
        geofenceCenterLat: position.coords.latitude,
        geofenceCenterLng: position.coords.longitude
      } : current);
      setNotice(t("teacherAttendance.schoolLocationCaptured"));
    } catch (captureError) {
      if (geolocationErrorCode(captureError) !== null) {
        // captureLocation already set a specific, actionable message.
        return;
      }
      setError(captureError instanceof Error ? captureError.message : t("teacherAttendance.locationUnavailable"));
    }
  };

  const correct = async (recordId: string) => {
    const correctionReason = window.prompt(t("teacherAttendance.correctionReason"));
    if (!correctionReason?.trim()) return;
    try {
      await requestWithAuth(`/teacher-attendance/admin/${recordId}/correct`, {
        method: "PATCH",
        body: JSON.stringify({ correctedToStatus: "on_time", correctionReason })
      });
      await load();
    } catch (correctionError) {
      setError(correctionError instanceof Error ? correctionError.message : t("teacherAttendance.correctionFailed"));
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await requestWithAuth<Settings>("/teacher-attendance/settings", {
        method: "PATCH",
        body: JSON.stringify(settings)
      });
      setSettings(updated);
      setNotice(t("teacherAttendance.settingsSaved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("teacherAttendance.settingsFailed"));
    } finally {
      setSaving(false);
    }
  };

  const openRequestModal = (type: "correction" | "manual", date: string, existingRecordId?: string) => {
    setRequestModal({ type, date, existingRecordId });
    setRequestStatusValue("on_time");
    setRequestReason("");
  };

  const submitRequestModal = async () => {
    if (!requestModal || !requestReason.trim()) return;
    setRequestSaving(true);
    setError(null);
    try {
      await requestWithAuth("/teacher-attendance/requests", {
        method: "POST",
        body: JSON.stringify({
          attendanceDate: requestModal.date,
          requestType: requestModal.type,
          requestedStatus: requestStatusValue,
          reason: requestReason.trim()
        })
      });
      setNotice(t("teacherAttendance.requestSubmitted"));
      setRequestModal(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("teacherAttendance.requestFailed"));
    } finally {
      setRequestSaving(false);
    }
  };

  const reviewRequest = async (requestId: string, decision: "approved" | "rejected", decisionNote?: string) => {
    setError(null);
    try {
      await requestWithAuth(`/teacher-attendance/admin/requests/${requestId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ decision, decisionNote })
      });
      setNotice(decision === "approved" ? t("teacherAttendance.requestApproved") : t("teacherAttendance.requestRejected"));
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : t("teacherAttendance.requestReviewFailed"));
    }
  };

  const openReviewModal = (requestId: string, teacherName: string, date: string) => {
    setReviewModal({ requestId, teacherName, date });
    setDecisionNoteValue("");
  };

  const submitReviewModal = async () => {
    if (!reviewModal) return;
    setReviewSaving(true);
    try {
      await reviewRequest(reviewModal.requestId, "rejected", decisionNoteValue.trim() || undefined);
      setReviewModal(null);
    } finally {
      setReviewSaving(false);
    }
  };

  const recordsByDate = useMemo(() => new Map(records.map((record) => [record.attendanceDate, record])), [records]);
  const overviewByDate = useMemo(() => new Map(overview.map((row) => [row.attendanceDate, row])), [overview]);
  const overviewByDateGroup = useMemo(() => {
    const map = new Map<string, OverviewRow[]>();
    for (const row of overview) {
      const list = map.get(row.attendanceDate) ?? [];
      list.push(row);
      map.set(row.attendanceDate, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [overview]);
  const scopedTeacherCount = useMemo(() => new Set(overview.map((row) => row.teacherId)).size, [overview]);
  const pendingAdminRequests = useMemo(() => adminRequests.filter((request) => request.status === "pending"), [adminRequests]);
  const decidedAdminRequests = useMemo(() => adminRequests.filter((request) => request.status !== "pending"), [adminRequests]);
  const pendingDatesSet = useMemo(() => new Set(myRequests.filter((request) => request.status === "pending").map((request) => request.attendanceDate)), [myRequests]);

  const elapsedDaysInMonth = viewMonth === currentMonthKey() ? Number(todayKey().slice(-2)) : monthBounds(viewMonth).daysInMonth;

  const teacherSummary = useMemo(() => {
    const present = records.filter((record) => record.status === "on_time" || record.status === "late" || record.status === "corrected").length;
    const onLeave = records.filter((record) => record.status === "on_leave").length;
    const missed = Math.max(elapsedDaysInMonth - present - onLeave, 0);
    return { present, onLeave, missed, elapsed: elapsedDaysInMonth };
  }, [records, elapsedDaysInMonth]);

  const adminSummaryRows = useMemo(() => {
    const map = new Map<string, { teacherId: string; teacherName: string; className: string; present: number; onLeave: number }>();
    for (const row of overview) {
      const entry = map.get(row.teacherId) ?? { teacherId: row.teacherId, teacherName: row.teacherName, className: row.className, present: 0, onLeave: 0 };
      if (row.status === "on_time" || row.status === "late" || row.status === "corrected") entry.present += 1;
      else if (row.status === "on_leave") entry.onLeave += 1;
      map.set(row.teacherId, entry);
    }
    return [...map.values()]
      .map((entry) => ({ ...entry, missed: Math.max(elapsedDaysInMonth - entry.present - entry.onLeave, 0), elapsed: elapsedDaysInMonth }))
      .sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  }, [overview, elapsedDaysInMonth]);

  if (loading) {
    return (
      <div className="page-content fade-in ta-page">
        <div className="ta-skeleton-stack">
          <div className="ta-skeleton ta-skeleton-head" />
          <div className="ta-skeleton ta-skeleton-card" />
          <div className="ta-skeleton ta-skeleton-card" />
        </div>
        <p className="ta-loading-text">{t("teacherAttendance.loading")}</p>
      </div>
    );
  }

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    ...(isAdmin ? [] : [{ key: "self" as TabKey, label: t("teacherAttendance.tabSelf"), icon: <Clock3 size={16} aria-hidden="true" /> }]),
    { key: "view", label: t("teacherAttendance.tabView"), icon: <CalendarDays size={16} aria-hidden="true" /> },
    { key: "summary", label: t("teacherAttendance.tabSummary"), icon: <PieChart size={16} aria-hidden="true" /> },
    ...(isAdmin ? [{ key: "requests" as TabKey, label: t("teacherAttendance.tabRequests"), icon: <FileEdit size={16} aria-hidden="true" /> }] : []),
    ...(isAdmin ? [{ key: "settings" as TabKey, label: t("teacherAttendance.tabSettings"), icon: <SlidersHorizontal size={16} aria-hidden="true" /> }] : []),
    { key: "leave", label: t("teacherAttendance.tabLeave"), icon: <History size={16} aria-hidden="true" /> }
  ];

  const todayRecord = records.find((record) => record.attendanceDate === todayKey());
  const attendanceDisabled = settings?.enabled === false;

  return (
    <div className="page-content fade-in ta-page">
      <header className="ta-hero">
        <div className="ta-hero-text">
          <span className="eyebrow">{isAdmin ? t("teacherAttendance.adminEyebrow") : t("teacherAttendance.teacherEyebrow")}</span>
          <h2>{isAdmin ? t("teacherAttendance.adminTitle") : t("teacherAttendance.title")}</h2>
          <p>{isAdmin ? t("teacherAttendance.adminHint") : t("teacherAttendance.hint")}</p>
        </div>
        <span className="ta-date-chip"><CalendarDays size={14} aria-hidden="true" />{formatDate(todayKey())}</span>
      </header>

      <div className="ta-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`ta-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <div className="ta-banner danger" role="alert"><ShieldAlert size={18} aria-hidden="true" /><p>{error}</p></div> : null}
      {notice ? <div className="ta-banner success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><p>{notice}</p></div> : null}

      {activeTab === "self" && !isAdmin ? (
        <section className={`ta-card ta-checkin ${todayRecord ? "is-done" : ""}`}>
          <div className="ta-card-header">
            <div className="ta-card-title">
              <span className="ta-card-icon"><Clock3 size={18} aria-hidden="true" /></span>
              <div><h3>{t("teacherAttendance.today")}</h3><p>{t("teacherAttendance.window", { start: settings?.markWindowStart ?? "--:--", end: settings?.markWindowEnd ?? "--:--" })}</p></div>
            </div>
            <span className={`status-badge ${todayRecord ? statusTone(todayRecord.status) : "default"}`}>
              {todayRecord ? t(`teacherAttendance.status.${todayRecord.status}`, { defaultValue: todayRecord.status }) : t("teacherAttendance.status.notMarked")}
            </span>
          </div>

          {todayRecord ? (
            <div className="ta-done-state">
              <span className="ta-done-icon" aria-hidden="true"><CheckCircle2 size={30} /></span>
              <strong>{t("teacherAttendance.checkedInAt", { time: formatTime(todayRecord.checkInAtServer) })}</strong>
              <small><MapPin size={13} aria-hidden="true" /> {Math.round(todayRecord.distanceMeters ?? 0)} m</small>
            </div>
          ) : attendanceDisabled ? (
            <div className="ta-banner muted"><ShieldAlert size={18} aria-hidden="true" /><p>{t("teacherAttendance.disabled")}</p></div>
          ) : (
            <div className="ta-checkin-body">
              <div className={`ta-gps ${locationStatus}`} role="status" aria-live="polite">
                <div className="ta-gps-visual" aria-hidden="true">
                  <span className="ta-gps-ripple" />
                  <span className="ta-gps-ripple delay" />
                  <span className="ta-gps-pin">
                    {locationStatus === "captured" ? <CheckCircle2 size={22} />
                      : locationStatus === "out_of_range" || locationStatus === "error" ? <ShieldAlert size={22} />
                        : <MapPin size={22} />}
                  </span>
                </div>
                <div className="ta-gps-text">
                  <strong>
                    {locationStatus === "capturing" ? t("teacherAttendance.locatingAnimation")
                      : locationStatus === "captured" ? t("teacherAttendance.locationCaptured", { meters: Math.round(locationAccuracy ?? 0) })
                        : locationStatus === "out_of_range" ? t("teacherAttendance.outOfRange")
                          : locationStatus === "error" ? (locationDenied ? t("teacherAttendance.locationBlocked") : t("teacherAttendance.locationUnavailable"))
                            : t("teacherAttendance.locationRequired")}
                  </strong>
                  {locationStatus === "capturing" ? <span className="ta-gps-dots" aria-hidden="true"><i /><i /><i /></span> : null}
                </div>
              </div>

              {locationStatus === "out_of_range" ? (
                <div className="ta-banner danger"><ShieldAlert size={18} aria-hidden="true" /><p>{t("teacherAttendance.outOfRangeError")}</p></div>
              ) : null}

              {locationStatus === "error" && locationDenied ? (
                <div className="ta-permission-help">
                  <div className="ta-permission-head">
                    <LockKeyhole size={16} aria-hidden="true" />
                    <strong>{t("teacherAttendance.permissionHelpTitle")}</strong>
                  </div>
                  <ol className="ta-permission-steps">
                    <li>{t("teacherAttendance.permissionStep1")}</li>
                    <li>{t("teacherAttendance.permissionStep2")}</li>
                    <li>{t("teacherAttendance.permissionStep3")}</li>
                  </ol>
                </div>
              ) : null}

              <div className="ta-action-stack">
                <button type="button" className={`ta-btn ${locationStatus === "error" ? "warning" : "outline"}`} onClick={() => void captureLocation().catch(() => undefined)} disabled={locationStatus === "capturing"}>
                  {locationStatus === "error"
                    ? <RefreshCw size={16} aria-hidden="true" />
                    : <Navigation size={16} className={locationStatus === "capturing" ? "ta-spin" : undefined} aria-hidden="true" />}
                  {locationStatus === "capturing" ? t("teacherAttendance.locating")
                    : locationStatus === "error" ? t("teacherAttendance.retryLocation")
                      : locationStatus === "captured" || locationStatus === "out_of_range" ? t("teacherAttendance.refreshLocation")
                        : t("teacherAttendance.getLocation")}
                </button>
                <button type="button" className="ta-btn primary" disabled={saving || locationStatus !== "captured"} onClick={() => void markAttendance()}>
                  <MapPin size={16} aria-hidden="true" />
                  {saving ? t("teacherAttendance.marking") : t("teacherAttendance.mark")}
                </button>
              </div>
            </div>
          )}

          <div className="ta-manual-apply">
            <FilePlus2 size={15} aria-hidden="true" />
            <span>{t("teacherAttendance.manualApplyHint")}</span>
            <button type="button" className="ta-btn ghost small" onClick={() => setActiveTab("view")}>{t("teacherAttendance.goToAttendanceView")}</button>
          </div>
        </section>
      ) : null}

      {activeTab === "view" ? (
        <>
          {isAdmin ? (
            <>
              <div className="ta-stat-grid">
                <div className="ta-stat"><span className="ta-stat-label"><Users size={14} aria-hidden="true" />{t("teacherAttendance.totalTeachers")}</span><strong>{scopedTeacherCount}</strong></div>
                <div className="ta-stat success"><span className="ta-stat-label">{t("teacherAttendance.onTime")}</span><strong>{overview.filter((row) => row.status === "on_time").length}</strong></div>
                <div className="ta-stat warning"><span className="ta-stat-label">{t("teacherAttendance.lateCount")}</span><strong>{overview.filter((row) => row.status === "late").length}</strong></div>
                <div className="ta-stat danger"><span className="ta-stat-label">{t("teacherAttendance.missedCount")}</span><strong>{overview.filter((row) => row.status === "missed").length}</strong></div>
              </div>

              <section className="ta-card ta-filter-bar">
                <label className="ta-field">{t("teacherAttendance.filterClass")}
                  <select value={filterClassId} onChange={(event) => setFilterClassId(event.target.value)}>
                    <option value="">{t("teacherAttendance.allClasses")}</option>
                    {classes.map((item) => <option value={item._id} key={item._id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="ta-field">{t("teacherAttendance.filterTeacher")}
                  <select value={filterTeacherId} onChange={(event) => setFilterTeacherId(event.target.value)}>
                    <option value="">{t("teacherAttendance.allTeachers")}</option>
                    {teachers.map((item) => <option value={item._id} key={item._id}>{item.fullName}</option>)}
                  </select>
                </label>
              </section>
            </>
          ) : null}

          <section className="ta-card">
            <div className="ta-card-header">
              <div className="ta-card-title">
                <span className="ta-card-icon"><History size={18} aria-hidden="true" /></span>
                <div><h3>{t("teacherAttendance.history")}</h3></div>
              </div>
              <div className="ta-view-switch">
                <button type="button" className={viewMode === "list" ? "view-switch-btn selected" : "view-switch-btn"} onClick={() => changeViewMode("list")} aria-label={t("teacherAttendance.viewList")}><List size={16} /></button>
                <button type="button" className={viewMode === "tile" ? "view-switch-btn selected" : "view-switch-btn"} onClick={() => changeViewMode("tile")} aria-label={t("teacherAttendance.viewTile")}><LayoutGrid size={16} /></button>
                <button
                  type="button"
                  className={viewMode === "calendar" ? "view-switch-btn selected" : "view-switch-btn"}
                  onClick={() => changeViewMode("calendar")}
                  aria-label={t("teacherAttendance.viewCalendar")}
                  disabled={isAdmin && !filterTeacherId}
                  title={isAdmin && !filterTeacherId ? t("teacherAttendance.selectTeacherForCalendar") : undefined}
                >
                  <Rows3 size={16} />
                </button>
              </div>
            </div>

            <div className="ta-month-nav">
              <button type="button" className="ta-btn ghost small" onClick={() => setViewMonth((month) => shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
              <strong>{formatMonthLabel(viewMonth)}</strong>
              <button type="button" className="ta-btn ghost small" onClick={() => setViewMonth((month) => shiftMonth(month, 1))} disabled={viewMonth >= currentMonthKey()}><ChevronRight size={16} aria-hidden="true" /></button>
            </div>

            {!isAdmin && viewMode === "calendar" ? (
              <div className="ta-calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span className="ta-calendar-weekday" key={day}>{day}</span>)}
                {buildCalendarCells(viewMonth).map((date, index) => {
                  if (!date) return <span className="ta-calendar-cell empty" key={`empty-${index}`} />;
                  const record = recordsByDate.get(date);
                  const isFuture = date > todayKey();
                  const isPending = pendingDatesSet.has(date);
                  const tone = record ? statusTone(record.status) : isFuture ? "" : "absent";
                  return (
                    <button
                      type="button"
                      key={date}
                      className={`ta-calendar-cell ${tone} ${date === todayKey() ? "is-today" : ""}`}
                      disabled={isFuture}
                      onClick={() => {
                        if (isFuture || isPending) return;
                        if (record) openRequestModal("correction", date, record._id);
                        else openRequestModal("manual", date);
                      }}
                      title={record ? t(`teacherAttendance.status.${record.status}`, { defaultValue: record.status }) : undefined}
                    >
                      <span className="ta-calendar-date">{Number(date.slice(-2))}</span>
                      {isPending ? <span className="ta-calendar-pending-dot" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {isAdmin && viewMode === "calendar" ? (
              filterTeacherId ? (
                <div className="ta-calendar-grid">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span className="ta-calendar-weekday" key={day}>{day}</span>)}
                  {buildCalendarCells(viewMonth).map((date, index) => {
                    if (!date) return <span className="ta-calendar-cell empty" key={`empty-${index}`} />;
                    const row = overviewByDate.get(date);
                    const isFuture = date > todayKey();
                    const tone = row ? statusTone(row.status) : isFuture ? "" : "absent";
                    return (
                      <button
                        type="button"
                        key={date}
                        className={`ta-calendar-cell ${tone} ${date === todayKey() ? "is-today" : ""}`}
                        disabled={isFuture || !row?.record}
                        onClick={() => { if (row?.record) void correct(row.record._id); }}
                        title={row ? t(`teacherAttendance.status.${row.status}`, { defaultValue: row.status }) : undefined}
                      >
                        <span className="ta-calendar-date">{Number(date.slice(-2))}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="ta-empty"><Users size={26} aria-hidden="true" /><p>{t("teacherAttendance.selectTeacherForCalendar")}</p></div>
              )
            ) : null}

            {viewMode === "tile" ? (
              <div className="ta-tile-grid">
                {isAdmin ? (
                  filterTeacherId ? overview.map((row) => (
                    <div className="ta-tile" key={`${row.teacherId}-${row.attendanceDate}`}>
                      <span className={`status-badge ${statusTone(row.status)}`}>{t(`teacherAttendance.status.${row.status}`, { defaultValue: row.status })}</span>
                      <strong>{row.teacherName}</strong>
                      <small>{row.className}</small>
                      <small>{formatDate(row.attendanceDate)}</small>
                      {row.record ? <button type="button" className="ta-btn ghost small" onClick={() => void correct(row.record!._id)}>{t("teacherAttendance.correct")}</button> : null}
                    </div>
                  )) : overviewByDateGroup.map(([date, rows]) => (
                    <div className="ta-tile ta-tile-day" key={date}>
                      <strong>{formatDate(date)}</strong>
                      <small>{rows.filter((row) => row.status === "on_time").length} {t("teacherAttendance.onTime").toLowerCase()} · {rows.filter((row) => row.status === "late").length} {t("teacherAttendance.lateCount").toLowerCase()} · {rows.filter((row) => row.status === "missed").length} {t("teacherAttendance.missedCount").toLowerCase()}</small>
                      <div className="ta-day-teacher-chips">
                        {rows.map((row) => (
                          <button
                            type="button"
                            key={row.teacherId}
                            className={`ta-teacher-chip ${statusTone(row.status)}`}
                            onClick={() => { if (row.record) void correct(row.record._id); }}
                            title={`${row.teacherName} — ${t(`teacherAttendance.status.${row.status}`, { defaultValue: row.status })}`}
                          >
                            {row.teacherName}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : buildCalendarCells(viewMonth).filter((date): date is string => date !== null && date <= todayKey()).map((date) => {
                  const record = recordsByDate.get(date);
                  const isPending = pendingDatesSet.has(date);
                  return (
                    <div className="ta-tile" key={date}>
                      <span className={`status-badge ${record ? statusTone(record.status) : "absent"}`}>{record ? t(`teacherAttendance.status.${record.status}`, { defaultValue: record.status }) : t("teacherAttendance.status.missed")}</span>
                      <strong>{formatDate(date)}</strong>
                      {record ? <small>{t("teacherAttendance.checkIn")}: {formatTime(record.checkInAtServer)}</small> : null}
                      {isPending ? <small className="ta-pending-label">{t("teacherAttendance.requestPending")}</small> : (
                        <button type="button" className="ta-btn ghost small" onClick={() => record ? openRequestModal("correction", date, record._id) : openRequestModal("manual", date)}>
                          {record ? t("teacherAttendance.applyCorrection") : t("teacherAttendance.applyManual")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {viewMode === "list" ? (
              isAdmin ? (
                overview.length === 0 ? (
                  <div className="ta-empty"><Users size={26} aria-hidden="true" /><p>{t("teacherAttendance.noRecords")}</p></div>
                ) : filterTeacherId ? (
                  <ul className="ta-row-list">
                    {overview.map((row) => (
                      <li className="ta-row" key={`${row.teacherId}-${row.attendanceDate}`}>
                        <div className="ta-row-main">
                          <span className="ta-avatar" aria-hidden="true">{row.teacherName.trim().charAt(0).toUpperCase()}</span>
                          <div className="ta-row-text">
                            <strong>{row.teacherName}</strong>
                            <small>{row.className} · {formatDate(row.attendanceDate)}</small>
                          </div>
                        </div>
                        <div className="ta-row-side">
                          <span className={`status-badge ${statusTone(row.status)}`}>{t(`teacherAttendance.status.${row.status}`, { defaultValue: row.status })}</span>
                          {row.record ? (
                            <button type="button" className="ta-btn ghost small" onClick={() => void correct(row.record!._id)}>{t("teacherAttendance.correct")}</button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="ta-row-list">
                    {overviewByDateGroup.map(([date, rows]) => (
                      <li className="ta-row ta-row-grouped" key={date}>
                        <div className="ta-row-main">
                          <span className="ta-avatar date" aria-hidden="true"><CalendarDays size={16} /></span>
                          <div className="ta-row-text">
                            <strong>{formatDate(date)}</strong>
                            <small>{rows.filter((row) => row.status === "on_time").length} {t("teacherAttendance.onTime").toLowerCase()} · {rows.filter((row) => row.status === "late").length} {t("teacherAttendance.lateCount").toLowerCase()} · {rows.filter((row) => row.status === "missed").length} {t("teacherAttendance.missedCount").toLowerCase()}</small>
                          </div>
                        </div>
                        <div className="ta-day-teacher-chips">
                          {rows.map((row) => (
                            <button
                              type="button"
                              key={row.teacherId}
                              className={`ta-teacher-chip ${statusTone(row.status)}`}
                              onClick={() => { if (row.record) void correct(row.record._id); }}
                              title={`${row.teacherName} — ${t(`teacherAttendance.status.${row.status}`, { defaultValue: row.status })}`}
                            >
                              {row.teacherName}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : records.length === 0 ? (
                <div className="ta-empty"><History size={26} aria-hidden="true" /><p>{t("teacherAttendance.noRecords")}</p></div>
              ) : (
                <ul className="ta-row-list">
                  {records.map((record) => {
                    const isPending = pendingDatesSet.has(record.attendanceDate);
                    return (
                      <li className={`ta-row ${record.attendanceDate === todayKey() ? "is-today" : ""}`} key={record._id}>
                        <div className="ta-row-main">
                          <span className="ta-avatar date" aria-hidden="true"><CalendarDays size={16} /></span>
                          <div className="ta-row-text">
                            <strong className="ta-row-title"><span className="ta-row-date">{formatDate(record.attendanceDate)}</span>{record.attendanceDate === todayKey() ? <span className="ta-today-tag">{t("teacherAttendance.todayTag")}</span> : null}</strong>
                            <small>{t("teacherAttendance.checkIn")}: {formatTime(record.checkInAtServer)}</small>
                          </div>
                        </div>
                        <div className="ta-row-side">
                          <span className={`status-badge ${statusTone(record.status)}`}>{t(`teacherAttendance.status.${record.status}`, { defaultValue: record.status })}</span>
                          {isPending ? <span className="ta-pending-label">{t("teacherAttendance.requestPending")}</span> : (
                            <button type="button" className="ta-btn ghost small" onClick={() => openRequestModal("correction", record.attendanceDate, record._id)}>{t("teacherAttendance.applyCorrection")}</button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </section>

          {!isAdmin ? (
            <section className="ta-card">
              <div className="ta-card-header">
                <div className="ta-card-title">
                  <span className="ta-card-icon"><FileEdit size={18} aria-hidden="true" /></span>
                  <div><h3>{t("teacherAttendance.myRequests")}</h3></div>
                </div>
                <span className="ta-count-chip">{myRequests.length}</span>
              </div>
              {myRequests.length === 0 ? (
                <div className="ta-empty"><FileEdit size={26} aria-hidden="true" /><p>{t("teacherAttendance.noRequests")}</p></div>
              ) : (
                <ul className="ta-row-list">
                  {myRequests.map((request) => (
                    <li className="ta-row" key={request._id}>
                      <div className="ta-row-main">
                        <span className="ta-avatar date" aria-hidden="true"><CalendarDays size={16} /></span>
                        <div className="ta-row-text">
                          <strong>{formatDate(request.attendanceDate)} · {t(`teacherAttendance.requestType.${request.requestType}`)}</strong>
                          <small>{request.reason}{request.decisionNote ? ` — ${request.decisionNote}` : ""}</small>
                        </div>
                      </div>
                      <span className={`status-badge ${requestStatusTone(request.status)}`}>{t(`teacherAttendance.requestStatus.${request.status}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "summary" ? (
        isAdmin ? (
          <article className="table-panel">
            <div className="table-header">
              <h3 className="panel-title">{t("teacherAttendance.summaryTitle")}</h3>
              <div className="table-controls">
                <span className="panel-subtitle">{t("teacherAttendance.summaryHint")}</span>
                <div className="ta-month-nav">
                  <button type="button" className="ta-btn ghost small" onClick={() => setViewMonth((month) => shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
                  <strong>{formatMonthLabel(viewMonth)}</strong>
                  <button type="button" className="ta-btn ghost small" onClick={() => setViewMonth((month) => shiftMonth(month, 1))} disabled={viewMonth >= currentMonthKey()}><ChevronRight size={16} aria-hidden="true" /></button>
                </div>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("teacherAttendance.teacher")}</th>
                    <th>{t("dashboard.class")}</th>
                    <th>{t("teacherAttendance.daysPresentLabel")}</th>
                    <th>{t("teacherAttendance.onLeaveDaysLabel")}</th>
                    <th>{t("teacherAttendance.missedDaysLabel")}</th>
                    <th>{t("teacherAttendance.summaryTotalDays")}</th>
                    <th>{t("dashboard.rateCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {adminSummaryRows.length === 0 ? (
                    <tr><td colSpan={7}>{t("teacherAttendance.noRecords")}</td></tr>
                  ) : (
                    adminSummaryRows.map((row) => {
                      const rate = row.elapsed > 0 ? Math.round((row.present / row.elapsed) * 100) : 0;
                      return (
                        <tr key={row.teacherId}>
                          <td>{row.teacherName}</td>
                          <td>{row.className}</td>
                          <td>{row.present}</td>
                          <td>{row.onLeave}</td>
                          <td>{row.missed}</td>
                          <td>{row.elapsed}</td>
                          <td><span className={`status-badge ${rate >= 80 ? "present" : rate >= 50 ? "late" : "absent"}`}>{rate}%</span></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        ) : (
          <section className="ta-card">
            <div className="ta-card-header">
              <div className="ta-card-title">
                <span className="ta-card-icon"><PieChart size={18} aria-hidden="true" /></span>
                <div><h3>{t("teacherAttendance.summaryTitle")}</h3><p>{t("teacherAttendance.summaryHint")}</p></div>
              </div>
            </div>

            <div className="ta-month-nav">
              <button type="button" className="ta-btn ghost small" onClick={() => setViewMonth((month) => shiftMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
              <strong>{formatMonthLabel(viewMonth)}</strong>
              <button type="button" className="ta-btn ghost small" onClick={() => setViewMonth((month) => shiftMonth(month, 1))} disabled={viewMonth >= currentMonthKey()}><ChevronRight size={16} aria-hidden="true" /></button>
            </div>

            <div className="ta-summary-hero">
              <div className="ta-summary-fraction large">
                <strong>{teacherSummary.present} / {teacherSummary.elapsed}</strong>
                <small>{t("teacherAttendance.daysPresent")}</small>
              </div>
              <div className="ta-summary-percent">
                {teacherSummary.elapsed > 0 ? Math.round((teacherSummary.present / teacherSummary.elapsed) * 100) : 0}%
              </div>
              <div className="ta-stat-grid">
                <div className="ta-stat success"><span className="ta-stat-label">{t("teacherAttendance.daysPresentLabel")}</span><strong>{teacherSummary.present}</strong></div>
                <div className="ta-stat"><span className="ta-stat-label">{t("teacherAttendance.onLeaveDaysLabel")}</span><strong>{teacherSummary.onLeave}</strong></div>
                <div className="ta-stat danger"><span className="ta-stat-label">{t("teacherAttendance.missedDaysLabel")}</span><strong>{teacherSummary.missed}</strong></div>
              </div>
            </div>
          </section>
        )
      ) : null}

      {activeTab === "requests" && isAdmin ? (
        <>
          <section className="ta-card">
            <div className="ta-card-header">
              <div className="ta-card-title">
                <span className="ta-card-icon"><FileEdit size={18} aria-hidden="true" /></span>
                <div><h3>{t("teacherAttendance.pendingRequests")}</h3><p>{t("teacherAttendance.pendingRequestsHint")}</p></div>
              </div>
              <span className="ta-count-chip">{pendingAdminRequests.length}</span>
            </div>
            {pendingAdminRequests.length === 0 ? (
              <div className="ta-empty"><FileEdit size={26} aria-hidden="true" /><p>{t("teacherAttendance.noPendingRequests")}</p></div>
            ) : (
              <ul className="ta-row-list">
                {pendingAdminRequests.map((request) => (
                  <li className="ta-row" key={request._id}>
                    <div className="ta-row-main">
                      <span className="ta-avatar" aria-hidden="true">{request.teacherName.trim().charAt(0).toUpperCase()}</span>
                      <div className="ta-row-text">
                        <strong>{request.teacherName} · {formatDate(request.attendanceDate)}</strong>
                        <small>{t(`teacherAttendance.requestType.${request.requestType}`)} → {t(`teacherAttendance.status.${request.requestedStatus}`)} · {request.reason}</small>
                      </div>
                    </div>
                    <div className="ta-row-side">
                      <button type="button" className="ta-btn primary small" onClick={() => void reviewRequest(request._id, "approved")}><Check size={14} aria-hidden="true" />{t("teacherAttendance.approve")}</button>
                      <button type="button" className="ta-btn ghost small" onClick={() => openReviewModal(request._id, request.teacherName, request.attendanceDate)}><X size={14} aria-hidden="true" />{t("teacherAttendance.reject")}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ta-card">
            <div className="ta-card-header">
              <div className="ta-card-title">
                <span className="ta-card-icon"><History size={18} aria-hidden="true" /></span>
                <div><h3>{t("teacherAttendance.requestHistory")}</h3><p>{t("teacherAttendance.requestHistoryHint")}</p></div>
              </div>
              <span className="ta-count-chip">{decidedAdminRequests.length}</span>
            </div>
            {decidedAdminRequests.length === 0 ? (
              <div className="ta-empty"><History size={26} aria-hidden="true" /><p>{t("teacherAttendance.noRequestHistory")}</p></div>
            ) : (
              <ul className="ta-row-list">
                {decidedAdminRequests.map((request) => (
                  <li className="ta-row" key={request._id}>
                    <div className="ta-row-main">
                      <span className="ta-avatar" aria-hidden="true">{request.teacherName.trim().charAt(0).toUpperCase()}</span>
                      <div className="ta-row-text">
                        <strong>{request.teacherName} · {formatDate(request.attendanceDate)}</strong>
                        <small>{t(`teacherAttendance.requestType.${request.requestType}`)} → {t(`teacherAttendance.status.${request.requestedStatus}`)} · {request.reason}{request.decisionNote ? ` — ${request.decisionNote}` : ""}</small>
                      </div>
                    </div>
                    <span className={`status-badge ${requestStatusTone(request.status)}`}>{t(`teacherAttendance.requestStatus.${request.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "settings" && isAdmin && settings ? (
        <form className="ta-card ta-settings" onSubmit={saveSettings}>
          <div className="ta-card-header">
            <div className="ta-card-title">
              <span className="ta-card-icon"><SlidersHorizontal size={18} aria-hidden="true" /></span>
              <div><h3>{t("teacherAttendance.settings")}</h3><p>{t("teacherAttendance.settingsHint")}</p></div>
            </div>
            <label className="ta-switch">
              <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
              <span className="ta-switch-track" aria-hidden="true"><span className="ta-switch-thumb" /></span>
              <span className="ta-switch-text">{t("teacherAttendance.enabled")}</span>
            </label>
          </div>

          <div className="ta-field-grid">
            <label className="ta-field">{t("teacherAttendance.windowStart")}<input type="time" value={settings.markWindowStart} onChange={(event) => setSettings({ ...settings, markWindowStart: event.target.value })} /></label>
            <label className="ta-field">{t("teacherAttendance.windowEnd")}<input type="time" value={settings.markWindowEnd} onChange={(event) => setSettings({ ...settings, markWindowEnd: event.target.value })} /></label>
            <label className="ta-field">{t("teacherAttendance.threshold")}<input type="time" value={settings.inTimeThreshold} onChange={(event) => setSettings({ ...settings, inTimeThreshold: event.target.value })} /></label>
            <label className="ta-field">{t("teacherAttendance.radius")}<input type="number" min="1" inputMode="numeric" value={settings.geofenceRadiusMeters} onChange={(event) => setSettings({ ...settings, geofenceRadiusMeters: Number(event.target.value) })} /></label>
          </div>

          <div className="ta-geo-box">
            <div className="ta-geo-info">
              <span className="ta-field-label">{t("teacherAttendance.schoolLocation")}</span>
              <strong className="ta-coords">{settings.geofenceCenterLat.toFixed(6)}, {settings.geofenceCenterLng.toFixed(6)}</strong>
              <small>{locationAccuracy !== null ? t("teacherAttendance.accuracy", { meters: Math.round(locationAccuracy) }) : t("teacherAttendance.locationSaved")}</small>
            </div>
            <button type="button" className="ta-btn ghost" onClick={() => void captureSchoolLocation()} disabled={locationStatus === "capturing"}>
              <Crosshair size={16} className={locationStatus === "capturing" ? "ta-spin" : undefined} aria-hidden="true" />
              {locationStatus === "capturing" ? t("teacherAttendance.locating") : t("teacherAttendance.useCurrentLocation")}
            </button>
          </div>

          <div className="ta-card-actions">
            <button type="submit" className="ta-btn primary" disabled={saving}>{saving ? t("teacherAttendance.saving") : t("teacherAttendance.saveSettings")}</button>
          </div>
        </form>
      ) : null}

      {activeTab === "leave" ? <LeavePage role={isAdmin ? "admin" : "teacher"} requestWithAuth={requestWithAuth} /> : null}

      {requestModal ? (
        <div className="ta-modal-overlay" role="dialog" aria-modal="true" onClick={() => setRequestModal(null)}>
          <div className="ta-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ta-modal-header">
              <h3>{requestModal.type === "correction" ? t("teacherAttendance.applyCorrectionTitle") : t("teacherAttendance.applyManualTitle")}</h3>
              <button type="button" className="ta-btn ghost small" onClick={() => setRequestModal(null)}><X size={16} aria-hidden="true" /></button>
            </div>
            <p className="ta-modal-date">{formatDate(requestModal.date)}</p>
            <label className="ta-field">{t("teacherAttendance.requestedStatus")}
              <select value={requestStatusValue} onChange={(event) => setRequestStatusValue(event.target.value as typeof requestStatusValue)}>
                <option value="on_time">{t("teacherAttendance.status.on_time")}</option>
                <option value="late">{t("teacherAttendance.status.late")}</option>
                <option value="on_leave">{t("teacherAttendance.status.on_leave")}</option>
              </select>
            </label>
            <label className="ta-field">{t("teacherAttendance.requestReason")}
              <textarea rows={3} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder={t("teacherAttendance.requestReasonPlaceholder") ?? ""} />
            </label>
            <div className="ta-card-actions">
              <button type="button" className="ta-btn primary" disabled={requestSaving || !requestReason.trim()} onClick={() => void submitRequestModal()}>
                {requestSaving ? t("teacherAttendance.saving") : t("teacherAttendance.submitRequest")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewModal ? (
        <div className="ta-modal-overlay" role="dialog" aria-modal="true" onClick={() => setReviewModal(null)}>
          <div className="ta-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ta-modal-header">
              <h3>{t("teacherAttendance.rejectRequestTitle")}</h3>
              <button type="button" className="ta-btn ghost small" onClick={() => setReviewModal(null)}><X size={16} aria-hidden="true" /></button>
            </div>
            <p className="ta-modal-date">{reviewModal.teacherName} · {formatDate(reviewModal.date)}</p>
            <label className="ta-field">{t("teacherAttendance.decisionNote")}
              <textarea rows={3} value={decisionNoteValue} onChange={(event) => setDecisionNoteValue(event.target.value)} placeholder={t("teacherAttendance.decisionNotePlaceholder") ?? ""} />
            </label>
            <div className="ta-card-actions">
              <button type="button" className="ta-btn primary" disabled={reviewSaving} onClick={() => void submitReviewModal()}>
                {reviewSaving ? t("teacherAttendance.saving") : t("teacherAttendance.reject")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

