import classNames from "classnames";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { 
  Bar, BarChart as RechartsBarChart, CartesianGrid, Cell, Line, LineChart, 
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis 
} from "recharts";
import {
  Activity, CheckCircle, ChevronRight, ChevronsLeft, ChevronsRight, Clock,
  LayoutDashboard, LayoutGrid, List, LogOut, MoreHorizontal, Rows3, Settings, ShieldAlert,
  Sun, Users, CheckSquare, AlertTriangle, AlertCircle, BarChart as BarChartIcon,
  Database, MessageCircle, FileSpreadsheet, UserX, X
} from "lucide-react";
import { setLanguage } from "./i18n";
import { PageLoader, InlineLoader } from "./components/Loader";
import { PasswordInput } from "./components/PasswordInput";
import { ATTENDANCE_VIEW_MODE_KEY, DEFAULT_REPORT_DAYS_KEY } from "./lib/preferences";
import { useToast } from "./lib/toast";
import DataTransferPage from "./pages/DataTransferPage";
import LandingPage from "./pages/LandingPage";
import ManagePage from "./pages/ManagePage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";

type BackendRole = "admin" | "teacher";
type UiRole = BackendRole;

type SessionUser = {
  id: string;
  fullName: string;
  username: string;
  roles: BackendRole[];
  activeRole: BackendRole;
  mustChangePassword: boolean;
};

type SessionState = {
  accessToken: string;
  user: SessionUser;
};

type ClassItem = {
  _id: string;
  name: string;
};

type StudentItem = {
  _id: string;
  fullName: string;
  rollNumber?: string;
};

type ReportTrendItem = {
  date: string;
  total: number;
  presentLike: number;
  rate: number;
};

type ReportStatusItem = {
  status: string;
  count: number;
};

type StatusCounts = {
  present: number;
  absent: number;
  late: number;
  half_day: number;
};

type DayStatus = {
  date: string;
  status: StatusCounts;
};

type ReportClassHealth = {
  classId: string;
  className: string;
  academicSession: string;
  total: number;
  presentLike: number;
  rate: number;
};

type AbsenceInsightStudent = {
  studentId: string;
  studentName: string;
  rollNumber?: string;
  classId: string;
  className: string;
  absenceCount: number;
};

type ClassAbsenceInsight = {
  classId: string;
  className: string;
  students: AbsenceInsightStudent[];
};

type ReportOverview = {
  generatedAt: string;
  totals: {
    students: number;
    classes: number;
    todayMarked: number;
    todayPresentLike: number;
    todayRate: number;
  };
  today: DayStatus;
  previous: DayStatus | null;
  trend: ReportTrendItem[];
  statusBreakdown: ReportStatusItem[];
  classHealth: ReportClassHealth[];
  absenceInsights: {
    byClass: ClassAbsenceInsight[];
    schoolTop?: AbsenceInsightStudent[];
  };
};

type TimelineItem = {
  id: string;
  attendanceDate: string;
  classId: string;
  className: string;
  session: string;
  totalMarked: number;
  presentLike: number;
  rate: number;
};

type TimelineResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: TimelineItem[];
};

type AuditItem = {
  _id: string;
  createdAt: string;
  action: string;
  resource: string;
  method: string;
  path: string;
  statusCode: number;
  username?: string;
  role?: string;
  metadata?: Record<string, unknown>;
};

type AuditResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: AuditItem[];
};

type AttendanceStatus = "present" | "absent" | "late" | "half_day";

type AttendanceRecord = {
  _id: string;
  lockedAt?: string;
  entries: Array<{ studentId: string; status: AttendanceStatus; note?: string }>;
};

type AttendanceViewMode = "list" | "grid" | "compact";

type RoleGuardProps = {
  role: UiRole;
  allow: UiRole[];
  fallbackPath?: string;
  children: React.ReactElement;
};

type RequestWithAuth = <T>(path: string, options: RequestInit) => Promise<T>;
type RequestWithAuthRaw = (path: string, options: RequestInit) => Promise<Response>;

const SIDEBAR_PINNED_KEY = "sams.sidebarPinned";

const roleTranslationKey: Record<UiRole, string> = {
  admin: "admin",
  teacher: "teacher"
};

const statusLabel: Record<AttendanceStatus, string> = {
  present: "attendance.status.present",
  absent: "attendance.status.absent",
  late: "attendance.status.late",
  half_day: "attendance.status.halfDay"
};

const dashboardRoles: UiRole[] = ["admin", "teacher"];
const attendanceRoles: UiRole[] = ["admin", "teacher"];
const reportRoles: UiRole[] = ["admin", "teacher"];
const auditRoles: UiRole[] = ["admin"];
const manageRoles: UiRole[] = ["admin"];
// Teachers need Settings to change their own PIN; admin-only cards stay gated by canEditMasterData.
const settingsRoles: UiRole[] = ["admin", "teacher"];
const notificationRoles: UiRole[] = ["admin", "teacher"];
const dataTransferRoles: UiRole[] = ["admin"];
/** Roles allowed to mutate master data / settings; others get read-only screens. */
const masterDataWriteRoles: UiRole[] = ["admin"];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function toSessionState(value: unknown): SessionState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid session response");
  }

  const candidate = value as { user?: Partial<SessionUser>; accessToken?: unknown };
  const role = candidate.user?.activeRole;
  if (
    typeof candidate.accessToken !== "string"
    || !candidate.user
    || typeof candidate.user.id !== "string"
    || typeof candidate.user.fullName !== "string"
    || typeof candidate.user.username !== "string"
    || !Array.isArray(candidate.user.roles)
    || (role !== "admin" && role !== "teacher")
    || typeof candidate.user.mustChangePassword !== "boolean"
  ) {
    throw new Error("Invalid session response");
  }

  return value as SessionState;
}

function formatShortDate(isoDate: string, language: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(language === "hi" ? "hi-IN" : "en-GB", {
    day: "numeric",
    month: "short"
  });
}

/** Local YYYY-MM-DD. Never use toISOString() here: for timezones ahead of UTC it
 *  rolls back to the previous calendar day (QA-H03). */
function toLocalDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

async function apiRequest<T>(path: string, options: RequestInit, accessToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "include"
  });

  return parseResponse<T>(response);
}

function RoleGuard({ role, allow, fallbackPath = "/forbidden", children }: RoleGuardProps) {
  if (!allow.includes(role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
}

function Dashboard({ role, requestWithAuth }: { role: UiRole; requestWithAuth: RequestWithAuth }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [report, setReport] = useState<ReportOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [filterDays, setFilterDays] = useState(() => Number(localStorage.getItem(DEFAULT_REPORT_DAYS_KEY) ?? 30));
  const [filterClassId, setFilterClassId] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const classResponse = await requestWithAuth<{ items: ClassItem[] }>("/master-data/classes", { method: "GET" });
        setClasses(classResponse.items);
      } catch {
        // Filters are optional; ignore failures loading class lookups.
      }
    };
    void loadFilters();
  }, [requestWithAuth]);

  useEffect(() => {
    const controller = new AbortController();
    const loadReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ days: String(filterDays) });
        if (filterClassId) {
          query.set("classId", filterClassId);
        }
        const result = await requestWithAuth<ReportOverview>(`/reports/overview?${query.toString()}`, { method: "GET", signal: controller.signal });
        setReport(result);
      } catch (reportError) {
        if (controller.signal.aborted) {
          return;
        }
        const messageText = getErrorMessage(reportError);
        setError(messageText);
        toast.error(messageText);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void loadReport();
    return () => controller.abort();
  }, [requestWithAuth, filterDays, filterClassId, toast]);

  const stats = useMemo(() => {
    const today = report?.today.status;
    const previous = report?.previous?.status;
    const previousLabel = report?.previous ? formatShortDate(report.previous.date, i18n.language) : null;

    /** `goodWhenUp` flips the colour for metrics where a rise is a good thing. */
    const card = (
      label: string,
      icon: typeof Users,
      current: number,
      before: number | undefined,
      goodWhenUp = false
    ) => {
      let trend = t("dashboard.noCompare");
      let trendType = "neutral";

      if (before !== undefined) {
        const diff = current - before;
        if (diff === 0) {
          trend = t("dashboard.sameAs", { day: previousLabel });
        } else {
          trend = t("dashboard.vsDay", { delta: `${diff > 0 ? "+" : ""}${diff}`, day: previousLabel });
          trendType = diff > 0 === goodWhenUp ? "positive" : "negative";
        }
      }

      return { label, value: String(current), defaultIcon: icon, trend, trendType };
    };

    return [
      {
        label: t("dashboard.students"),
        value: String(report?.totals.students ?? 0),
        defaultIcon: Users,
        trend: report?.totals.classes === 1
          ? t("dashboard.acrossClass")
          : t("dashboard.acrossClasses", { count: report?.totals.classes ?? 0 }),
        trendType: "neutral"
      },
      card(t("dashboard.present"), Activity, today?.present ?? 0, previous?.present, true),
      card(t("dashboard.absent"), AlertCircle, today?.absent ?? 0, previous?.absent),
      card(t("dashboard.lateArrival"), Clock, today?.late ?? 0, previous?.late),
      card(t("dashboard.halfDay"), Sun, today?.half_day ?? 0, previous?.half_day)
    ];
  }, [i18n.language, report, t]);

  const chartData = useMemo(() => {
    return (report?.trend ?? []).slice(-15).map(item => ({
      date: item.date.slice(5),
      rate: item.rate
    }));
  }, [report]);

  const barData = useMemo(() => {
    return (report?.classHealth ?? []).map(item => ({
      name: item.className,
      rate: item.rate
    }));
  }, [report]);

  if (loading) return <div className="page-content"><PageLoader label={t("dashboard.loading")} /></div>;
  if (error) return <div className="page-content"><p className="error-text">{error}</p></div>;

  return (
    <div className="page-content fade-in">
      <div className="page-title-wrap">
        <span>{t("dashboard.crumb")}</span>
        <ChevronRight size={14} />
        <span className="active-crumb">{t("dashboard.crumbSub")}</span>
      </div>

      <div className="toolbar row-wrap dashboard-filters">
        {classes.length > 1 ? (
          <label>
            {t("dashboard.class")}
            <select value={filterClassId} onChange={(event) => setFilterClassId(event.target.value)}>
              <option value="">{t("dashboard.allClasses")}</option>
              {classes.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          {t("dashboard.dateRange")}
          <select value={filterDays} onChange={(event) => setFilterDays(Number(event.target.value))}>
            <option value={7}>{t("dashboard.lastDays", { count: 7 })}</option>
            <option value={14}>{t("dashboard.lastDays", { count: 14 })}</option>
            <option value={30}>{t("dashboard.lastDays", { count: 30 })}</option>
            <option value={60}>{t("dashboard.lastDays", { count: 60 })}</option>
            <option value={90}>{t("dashboard.lastDays", { count: 90 })}</option>
          </select>
        </label>
      </div>

      <div className="dashboard-top-grid">
        <article className="realtime-panel">
          <div>
            <div className="time-display">
              <Sun size={28} />
              <span>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
            </div>
            <div className="realtime-label">{t("dashboard.realtime")}</div>

            <div className="date-display">
              <div className="label">{t("dashboard.todayColon")}</div>
              <div className="value">
                {now.toLocaleDateString(i18n.language === "hi" ? "hi-IN" : "en-US", {
                  day: "numeric",
                  month: "long",
                  year: "numeric"
                })}
              </div>
            </div>
          </div>
        </article>

        <div className="stat-grid">
          {stats.map((item, idx) => {
            const Icon = item.defaultIcon;
            return (
              <article className="stat-card" key={idx}>
                <div className="stat-header">
                  <div className="stat-value">{item.value}</div>
                  <div className="stat-icon"><Icon size={18} /></div>
                </div>
                <div className="stat-title">{item.label}</div>
                <div className={classNames("stat-trend", item.trendType)}>
                  {item.trendType === "positive" && <CheckCircle size={12} />}
                  {item.trendType === "negative" && <AlertTriangle size={12} />}
                  {item.trendType === "neutral" && <CheckSquare size={12} />}
                  {item.trend}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="charts-grid">
        <article className="chart-panel">
          <div className="panel-header">
            <h3 className="panel-title">{t("dashboard.comparisonChart")}</h3>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip 
                  contentStyle={{ background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: "8px" }} 
                  cursor={{ stroke: "var(--accent-glow)", strokeWidth: 2 }}
                />
                <Line type="monotone" dataKey="rate" stroke="var(--accent-primary)" strokeWidth={3} dot={{ r: 4, fill: "var(--bg-panel)", strokeWidth: 2 }} activeDot={{ r: 6, fill: "var(--accent-primary)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="chart-panel">
          <div className="panel-header">
            <h3 className="panel-title">{t("dashboard.classHealth")}</h3>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height={240}>
              <RechartsBarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip 
                  contentStyle={{ background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: "8px" }} 
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                  {barData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={index === Math.floor(barData.length / 2) ? "var(--accent-primary)" : "var(--border)"} />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>

      <section className="absence-insights" aria-labelledby="absence-insights-title">
        <div className="insights-heading">
          <div>
            <span className="insights-kicker"><UserX size={15} /> {t("dashboard.attentionNeeded")}</span>
            <h2 id="absence-insights-title">{t("dashboard.mostAbsentStudents")}</h2>
          </div>
          <span className="panel-subtitle">{t("dashboard.lastDays", { count: filterDays })}</span>
        </div>

        <div className="absence-insight-grid">
          {role === "admin" ? (
            <article className="absence-insight-panel school-wide">
              <div className="absence-panel-header">
                <div>
                  <span className="absence-panel-scope">{t("dashboard.wholeSchool")}</span>
                  <h3>{t("dashboard.schoolTopThree")}</h3>
                </div>
                <span className="absence-scope-icon"><Users size={18} /></span>
              </div>
              <ol className="absence-ranking">
                {(report?.absenceInsights.schoolTop ?? []).map((student, index) => (
                  <li key={student.studentId}>
                    <span className="rank-number">{index + 1}</span>
                    <span className="rank-student">
                      <strong>{student.studentName}</strong>
                      <small>{student.className}{student.rollNumber ? ` · ${t("dashboard.rollNumber", { number: student.rollNumber })}` : ""}</small>
                    </span>
                    <span className="absence-count">{t("dashboard.absentDays", { count: student.absenceCount })}</span>
                  </li>
                ))}
                {(report?.absenceInsights.schoolTop ?? []).length === 0 ? (
                  <li className="absence-empty">{t("dashboard.noAbsences")}</li>
                ) : null}
              </ol>
            </article>
          ) : null}

          {(report?.absenceInsights.byClass ?? []).map((classInsight) => (
            <article className="absence-insight-panel" key={classInsight.classId}>
              <div className="absence-panel-header">
                <div>
                  <span className="absence-panel-scope">{t("dashboard.classTopThree")}</span>
                  <h3>{classInsight.className}</h3>
                </div>
                <span className="absence-scope-icon"><UserX size={18} /></span>
              </div>
              <ol className="absence-ranking">
                {classInsight.students.map((student, index) => (
                  <li key={student.studentId}>
                    <span className="rank-number">{index + 1}</span>
                    <span className="rank-student">
                      <strong>{student.studentName}</strong>
                      {student.rollNumber ? <small>{t("dashboard.rollNumber", { number: student.rollNumber })}</small> : null}
                    </span>
                    <span className="absence-count">{t("dashboard.absentDays", { count: student.absenceCount })}</span>
                  </li>
                ))}
                {classInsight.students.length === 0 ? (
                  <li className="absence-empty">{t("dashboard.noAbsences")}</li>
                ) : null}
              </ol>
            </article>
          ))}
          {role === "teacher" && (report?.absenceInsights.byClass ?? []).length === 0 ? (
            <article className="absence-insight-panel">
              <ol className="absence-ranking">
                <li className="absence-empty">{t("dashboard.noAbsences")}</li>
              </ol>
            </article>
          ) : null}
        </div>
      </section>

      <article className="table-panel">
        <div className="table-header">
          <h3 className="panel-title">{t("dashboard.classBreakdown")}</h3>
          <div className="table-controls">
            <span className="panel-subtitle">{t("dashboard.lastDays", { count: filterDays })}</span>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("dashboard.class")}</th>
                <th>{t("dashboard.session")}</th>
                <th>{t("dashboard.markedCol")}</th>
                <th>{t("dashboard.presentLike")}</th>
                <th>{t("dashboard.rateCol")}</th>
                <th>{t("dashboard.statusCol")}</th>
              </tr>
            </thead>
            <tbody>
              {(report?.classHealth ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6}>{t("dashboard.noneInPeriod")}</td>
                </tr>
              ) : (
                (report?.classHealth ?? []).map((item) => (
                  <tr key={item.classId}>
                    <td>{item.className}</td>
                    <td>{item.academicSession}</td>
                    <td>{item.total}</td>
                    <td>{item.presentLike}</td>
                    <td>{item.rate}%</td>
                    <td>
                      <span className={classNames("status-badge", item.rate >= 80 ? "present" : item.rate >= 50 ? "late" : "absent")}>
                        {item.rate >= 80 ? t("dashboard.good") : item.rate >= 50 ? t("dashboard.average") : t("dashboard.poor")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

function AttendancePage({ requestWithAuth, role }: { requestWithAuth: RequestWithAuth; role: UiRole }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [recordStudents, setRecordStudents] = useState<StudentItem[] | null>(null);
  const [selectedClass, setSelectedClass] = useState("");
  const [attendanceDate, setAttendanceDate] = useState<string>(() => toLocalDateKey());
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus | undefined>>({});
  const [existingId, setExistingId] = useState<string | null>(null);
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStudentsLoading, setIsStudentsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<AttendanceViewMode>(
    () => (localStorage.getItem(ATTENDANCE_VIEW_MODE_KEY) as AttendanceViewMode | null) ?? "list"
  );
  const [headCountOpen, setHeadCountOpen] = useState(false);
  const [headCount, setHeadCount] = useState("");
  const [headCountError, setHeadCountError] = useState<string | null>(null);
  const [alertPrompt, setAlertPrompt] = useState<{ count: number } | null>(null);
  const headCountRef = useRef<HTMLDivElement | null>(null);

  const today = toLocalDateKey();
  // A record locks teachers out once its lock window passes; admins can always correct.
  const isLocked = role === "teacher" && lockedAt != null && Date.now() > new Date(lockedAt).getTime();

  const changeViewMode = (mode: AttendanceViewMode) => {
    setViewMode(mode);
    localStorage.setItem(ATTENDANCE_VIEW_MODE_KEY, mode);
  };

  useEffect(() => {
    const loadMasterData = async () => {
      setIsLoading(true);

      try {
        const classResponse = await requestWithAuth<{ items: ClassItem[] }>("/master-data/classes?active=true", { method: "GET" });

        setClasses(classResponse.items);

        if (classResponse.items.length > 0) {
          setSelectedClass(classResponse.items[0]._id);
        }
      } catch {
        setClasses([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadMasterData();
  }, [requestWithAuth]);

  useEffect(() => {
    const controller = new AbortController();

    const loadStudents = async () => {
      if (!selectedClass) {
        setStudents([]);
        return;
      }

      setIsStudentsLoading(true);

      try {
        const query = new URLSearchParams({ classId: selectedClass });
        const response = await requestWithAuth<{ items: StudentItem[] }>(`/master-data/students?${query.toString()}`, {
          method: "GET",
          signal: controller.signal
        });

        setStudents(response.items);
      } catch {
        if (!controller.signal.aborted) {
          setStudents([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsStudentsLoading(false);
        }
      }
    };

    void loadStudents();
    return () => controller.abort();
  }, [requestWithAuth, selectedClass]);

  // Load any existing attendance record for the selected class + date, so it can be
  // reviewed and corrected instead of always presenting a blank board (QA-H01).
  useEffect(() => {
    const controller = new AbortController();

    const loadRecord = async () => {
      if (!selectedClass) {
        setAttendance({});
        setExistingId(null);
        setLockedAt(null);
        setRecordStudents(null);
        return;
      }

      try {
        const query = new URLSearchParams({ date: attendanceDate });
        const response = await requestWithAuth<{ item: AttendanceRecord | null; students?: StudentItem[] }>(
          `/attendance/class/${selectedClass}?${query.toString()}`,
          { method: "GET", signal: controller.signal }
        );

        if (controller.signal.aborted) {
          return;
        }

        if (response.item) {
          const nextMap: Record<string, AttendanceStatus> = {};
          for (const entry of response.item.entries) {
            nextMap[entry.studentId] = entry.status;
          }
          setAttendance(nextMap);
          setExistingId(response.item._id);
          setLockedAt(response.item.lockedAt ?? null);
          setRecordStudents(response.students ?? null);
        } else {
          setAttendance({});
          setExistingId(null);
          setLockedAt(null);
          setRecordStudents(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setAttendance({});
          setExistingId(null);
          setLockedAt(null);
          setRecordStudents(null);
        }
      }
    };

    void loadRecord();
    return () => controller.abort();
  }, [requestWithAuth, selectedClass, attendanceDate]);

  // Head-count dialog: close on Escape, trap Tab focus inside it, and restore focus on close.
  useEffect(() => {
    if (!headCountOpen) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        headCountRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.hasAttribute("disabled"));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHeadCountOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const items = focusable();
        if (items.length === 0) {
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [headCountOpen]);

  // When editing a saved record, the board is driven by the students on that record
  // (so deactivated/moved students still show); a new record uses the live roster.
  const boardStudents = existingId && recordStudents ? recordStudents : students;

  const markedCount = useMemo(() => Object.values(attendance).filter((status) => status !== undefined).length, [attendance]);

  const allMarked = boardStudents.length > 0 && markedCount === boardStudents.length;

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    if (isLocked) {
      return;
    }
    setAttendance((previous) => ({ ...previous, [studentId]: status }));
  };

  const markAllPresent = () => {
    if (isLocked) {
      return;
    }
    const nextState: Record<string, AttendanceStatus> = {};
    for (const student of boardStudents) {
      nextState[student._id] = "present";
    }
    setAttendance(nextState);
  };

  const clearAll = () => {
    if (isLocked) {
      return;
    }
    setAttendance({});
    setMessage(null);
  };

  /** Students physically in the room: present, arrived late, or in for half the day. */
  const expectedHeadCount = useMemo(
    () =>
      boardStudents.filter((student) => {
        const status = attendance[student._id];
        return status === "present" || status === "late" || status === "half_day";
      }).length,
    [boardStudents, attendance]
  );

  const openHeadCount = () => {
    if (!allMarked || !selectedClass || isLocked) {
      return;
    }

    setHeadCount("");
    setHeadCountError(null);
    setHeadCountOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const counted = Number(headCount);
    if (!headCount.trim() || !Number.isInteger(counted) || counted < 0) {
      setHeadCountError(t("attendance.headCountEnter"));
      return;
    }

    if (counted !== expectedHeadCount) {
      // Reveal both figures only after a mismatch so the teacher can reconcile (QA-L04).
      setHeadCountError(t("attendance.headCountMismatch", { counted, expected: expectedHeadCount }));
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setHeadCountError(null);

    try {
      const entries = boardStudents.map((student) => ({
        studentId: student._id,
        status: attendance[student._id] as AttendanceStatus
      }));
      const notFullyPresentCount = entries.filter((entry) => entry.status !== "present").length;

      if (existingId) {
        const result = await requestWithAuth<{ item: AttendanceRecord }>(
          `/attendance/${existingId}`,
          { method: "PATCH", body: JSON.stringify({ entries }) }
        );
        setLockedAt(result.item.lockedAt ?? lockedAt);
        setMessage(t("attendance.updateSuccess"));
        toast.success(t("attendance.updateSuccess"));
      } else {
        const result = await requestWithAuth<{ item: AttendanceRecord }>(
          "/attendance/submit",
          { method: "POST", body: JSON.stringify({ classId: selectedClass, attendanceDate, entries }) }
        );
        setExistingId(result.item._id);
        setLockedAt(result.item.lockedAt ?? null);
        setMessage(t("attendance.submitSuccess"));
        toast.success(t("attendance.submitSuccess"));
      }

      setHeadCountOpen(false);
      setAlertPrompt({ count: notFullyPresentCount });
    } catch (submitError) {
      const messageText = getErrorMessage(submitError);
      setHeadCountError(messageText);
      toast.error(messageText);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="attendance-stack">
      <section className="simple-panel attendance-controls">
        <h2>{t("attendance.title")}</h2>
        <p>{t("attendance.hint")}</p>
        <div className="toolbar row-wrap">
          <label>
            {t("attendance.class")}
            <select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} disabled={isLoading || classes.length === 0}>
              {classes.length === 0 ? <option value="">{t("attendance.noClasses")}</option> : null}
              {classes.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("attendance.date")}
            <input
              type="date"
              value={attendanceDate}
              max={today}
              onChange={(event) => setAttendanceDate(event.target.value || today)}
            />
          </label>
          <button type="button" className="primary-btn" onClick={markAllPresent} disabled={isLocked}>
            {t("attendance.markAllPresent")}
          </button>
          <button type="button" className="ghost-btn" onClick={clearAll} disabled={isLocked}>
            {t("attendance.undoAll")}
          </button>
          <div className="view-switcher" role="group" aria-label={t("attendance.switchView")}>
            <button
              type="button"
              className={viewMode === "list" ? "view-switch-btn selected" : "view-switch-btn"}
              onClick={() => changeViewMode("list")}
              title={t("attendance.listView")}
              aria-label={t("attendance.listView")}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "view-switch-btn selected" : "view-switch-btn"}
              onClick={() => changeViewMode("grid")}
              title={t("attendance.gridView")}
              aria-label={t("attendance.gridView")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={viewMode === "compact" ? "view-switch-btn selected" : "view-switch-btn"}
              onClick={() => changeViewMode("compact")}
              title={t("attendance.compactView")}
              aria-label={t("attendance.compactView")}
            >
              <Rows3 size={16} />
            </button>
          </div>
        </div>
        <p className="progress-text">
          {t("attendance.marked")}: {markedCount}/{boardStudents.length}
        </p>
        {isLocked ? <p className="locked-note">{t("attendance.lockedNote")}</p> : null}
        {!isLocked && existingId ? <p className="policy-hint">{t("attendance.editingExisting")}</p> : null}
        {message ? <p className="success-text">{message}</p> : null}
      </section>

      <section className="simple-panel">
        <div className={`student-${viewMode}`}>
          {boardStudents.map((student) => (
            <article key={student._id} className={viewMode === "compact" ? "student-card compact" : "student-card"}>
              <div>
                <strong>{student.fullName || t("attendance.removedStudent")}</strong>
                <p>{t("attendance.roll")}: {student.rollNumber ?? "-"}</p>
              </div>
              <div className="status-actions">
                {Object.keys(statusLabel).map((statusKey) => {
                  const status = statusKey as AttendanceStatus;
                  const isSelected = attendance[student._id] === status;

                  return (
                    <button
                      type="button"
                      key={status}
                      className={isSelected ? "status-btn selected" : "status-btn"}
                      onClick={() => setStatus(student._id, status)}
                      disabled={isLocked}
                    >
                      {t(statusLabel[status])}
                    </button>
                  );
                })}
              </div>
            </article>
          ))}
          {isStudentsLoading ? <InlineLoader label={t("attendance.loadingStudents")} /> : null}
          {!isLoading && !isStudentsLoading && boardStudents.length === 0 ? <p>{t("attendance.noStudents")}</p> : null}
        </div>
      </section>

      <section className="simple-panel submit-panel">
        <button type="button" className="primary-btn" disabled={!allMarked || isSubmitting || isLocked} onClick={openHeadCount}>
          {existingId ? t("attendance.update") : t("attendance.submit")}
        </button>
        {isLocked ? (
          <p>{t("attendance.locked")}</p>
        ) : !allMarked ? (
          <p>{t("attendance.blockedUntilMarked")}</p>
        ) : (
          <p>{existingId ? t("attendance.readyToUpdate") : t("attendance.readyToSubmit")}</p>
        )}
      </section>

      {headCountOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setHeadCountOpen(false)}>
          <div
            className="modal-card"
            ref={headCountRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="head-count-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setHeadCountOpen(false);
              }
            }}
          >
            <div className="modal-header">
              <h2 id="head-count-title">{t("attendance.headCountTitle")}</h2>
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setHeadCountOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form className="settings-form" onSubmit={handleSubmit}>
              <div className="form-field">
                <label htmlFor="head-count">
                  {t("attendance.physicallyPresent")}
                  <span className="req">*</span>
                </label>
                <input
                  id="head-count"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  autoFocus
                  value={headCount}
                  onChange={(event) => setHeadCount(event.target.value)}
                />
                <p className="policy-hint">
                  {t("attendance.headCountHint")}
                </p>
              </div>

              {headCountError ? <p className="error-text">{headCountError}</p> : null}

              <div className="modal-footer">
                <button type="button" className="ghost-btn" onClick={() => setHeadCountOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="primary-btn" disabled={isSubmitting}>
                  {isSubmitting ? t("attendance.saving") : t("attendance.confirmSave")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {alertPrompt ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setAlertPrompt(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{t("attendance.notifyTitle")}</h2>
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setAlertPrompt(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="settings-body">
              {alertPrompt.count > 0 ? (
                <>
                  <p>{t("attendance.notifyReady", { count: alertPrompt.count })}</p>
                  <p className="policy-hint">
                    <MessageCircle size={14} /> {t("attendance.notifyReview")}
                  </p>
                </>
              ) : (
                <p>{t("attendance.notifyNone")}</p>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="ghost-btn" onClick={() => setAlertPrompt(null)}>
                {alertPrompt.count > 0 ? t("attendance.notNow") : t("common.close")}
              </button>
              {alertPrompt.count > 0 ? (
                <button type="button" className="primary-btn" onClick={() => navigate("/alerts")}>
                  {t("attendance.sendWhatsApp")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportsPage({ requestWithAuth, requestWithAuthRaw }: { requestWithAuth: RequestWithAuth; requestWithAuthRaw: RequestWithAuthRaw }) {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMasterData = async () => {
      try {
        const classResponse = await requestWithAuth<{ items: ClassItem[] }>("/master-data/classes", { method: "GET" });
        setClasses(classResponse.items);
      } catch (masterDataError) {
        setError(getErrorMessage(masterDataError));
      }
    };

    void loadMasterData();
  }, [requestWithAuth]);

  useEffect(() => {
    const controller = new AbortController();
    const loadTimeline = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (classId) {
          query.set("classId", classId);
        }
        if (status) {
          query.set("status", status);
        }
        if (fromDate) {
          query.set("fromDate", fromDate);
        }
        if (toDate) {
          query.set("toDate", toDate);
        }

        const response = await requestWithAuth<TimelineResponse>(`/reports/timeline?${query.toString()}`, { method: "GET", signal: controller.signal });
        setItems(response.items);
        setTotalPages(Math.max(1, response.totalPages));
      } catch (timelineError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(getErrorMessage(timelineError));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadTimeline();
    return () => controller.abort();
  }, [classId, fromDate, page, requestWithAuth, status, toDate]);

  const triggerExport = async (format: "csv" | "pdf") => {
    setError(null);
    try {
      const query = new URLSearchParams({ format });
      if (classId) {
        query.set("classId", classId);
      }
      if (status) {
        query.set("status", status);
      }
      if (fromDate) {
        query.set("fromDate", fromDate);
      }
      if (toDate) {
        query.set("toDate", toDate);
      }

      const response = await requestWithAuthRaw(`/reports/export?${query.toString()}`, { method: "GET" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body.message === "string" ? body.message : "Export failed";
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = format === "csv" ? "attendance-report.csv" : "attendance-report.pdf";
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(getErrorMessage(exportError));
    }
  };

  return (
    <div className="attendance-stack">
      <section className="simple-panel attendance-controls">
        <h2>{t("reports.title")}</h2>
        <p>{t("reports.subtitle")}</p>
        <div className="toolbar row-wrap">
          {classes.length > 1 ? (
            <label>
              {t("reports.class")}
              <select value={classId} onChange={(event) => { setClassId(event.target.value); setPage(1); }}>
                <option value="">{t("reports.allClasses")}</option>
                {classes.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {t("reports.status")}
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">{t("reports.any")}</option>
              <option value="present">{t("reports.present")}</option>
              <option value="absent">{t("reports.absent")}</option>
              <option value="late">{t("reports.late")}</option>
              <option value="half_day">{t("reports.halfDay")}</option>
            </select>
          </label>
          <label>
            {t("reports.from")}
            <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
          </label>
          <label>
            {t("reports.to")}
            <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
          </label>
        </div>
        <div className="toolbar row-wrap">
          <button type="button" className="primary-btn" onClick={() => triggerExport("csv")}>{t("reports.exportCsv")}</button>
          <button type="button" className="ghost-btn" onClick={() => triggerExport("pdf")}>{t("reports.exportPdf")}</button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <section className="simple-panel">
        {isLoading ? <InlineLoader label={t("reports.loadingTimeline")} /> : null}
        {!isLoading && items.length === 0 ? <p>{t("reports.noData")}</p> : null}
        {!isLoading && items.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("reports.colDate")}</th>
                  <th>{t("reports.colClass")}</th>
                  <th>{t("reports.colSession")}</th>
                  <th>{t("reports.colMarked")}</th>
                  <th>{t("reports.colPresentLike")}</th>
                  <th>{t("reports.colRate")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.attendanceDate}</td>
                    <td>{item.className}</td>
                    <td>{item.session}</td>
                    <td>{item.totalMarked}</td>
                    <td>{item.presentLike}</td>
                    <td>{item.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="toolbar row-wrap">
          <button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            {t("common.previous")}
          </button>
          <p className="progress-text">{t("reports.pageOf", { page, totalPages })}</p>
          <button type="button" className="ghost-btn" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
            {t("common.next")}
          </button>
        </div>
      </section>
    </div>
  );
}

function AuditTimelinePage({ requestWithAuth }: { requestWithAuth: RequestWithAuth }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [action, setAction] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams({ page: String(page), pageSize: "20" });
        if (action) {
          query.set("action", action);
        }

        const response = await requestWithAuth<AuditResponse>(`/audit-logs/timeline?${query.toString()}`, { method: "GET", signal: controller.signal });
        setItems(response.items);
        setTotalPages(Math.max(1, response.totalPages));
      } catch (auditError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(getErrorMessage(auditError));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [action, page, requestWithAuth]);

  return (
    <div className="attendance-stack">
      <section className="simple-panel attendance-controls">
        <h2>{t("audit.title")}</h2>
        <p>{t("audit.subtitle")}</p>
        <div className="toolbar row-wrap">
          <label>
            {t("audit.actionFilter")}
            <input value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} placeholder="AUTH_LOGIN" />
          </label>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <section className="simple-panel">
        {isLoading ? <InlineLoader label={t("audit.loading")} /> : null}
        {!isLoading && items.length === 0 ? <p>{t("audit.empty")}</p> : null}
        {!isLoading && items.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("audit.colTime")}</th>
                  <th>{t("audit.colAction")}</th>
                  <th>{t("audit.colActor")}</th>
                  <th>{t("audit.colRole")}</th>
                  <th>{t("audit.colMethod")}</th>
                  <th>{t("audit.colStatus")}</th>
                  <th>{t("audit.colPath")}</th>
                  <th>{t("audit.colDetails")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id}>
                    <td>{new Date(item.createdAt).toLocaleString(i18n.language === "hi" ? "hi-IN" : "en-IN")}</td>
                    <td>{item.action}</td>
                    <td>{item.username ?? "system"}</td>
                    <td>{item.role ?? "na"}</td>
                    <td>{item.method}</td>
                    <td>{item.statusCode}</td>
                    <td>{item.path}</td>
                    <td>
                      {item.metadata && Object.keys(item.metadata).length > 0 ? (
                        <dl className="audit-details">
                          {Object.entries(item.metadata).map(([key, value]) => (
                            <div key={key}>
                              <dt>{key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")}</dt>
                              <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <span className="muted-text">{t("audit.noDetails")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="toolbar row-wrap">
          <button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            {t("common.previous")}
          </button>
          <p className="progress-text">{t("audit.pageOf", { page, totalPages })}</p>
          <button type="button" className="ghost-btn" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
            {t("common.next")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <div className="attendance-stack">
      <section className="simple-panel">
        <h2>{t("forbidden.title")}</h2>
        <p>{t("forbidden.message")}</p>
      </section>
    </div>
  );
}

function LoginPage({ onLogin, pending, error }: { onLogin: (username: string, password: string) => Promise<void>; pending: boolean; error: string | null }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onLogin(username, password);
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>{t("auth.loginTitle")}</h1>
        <p>{t("auth.loginHint")}</p>
        <label>
          {t("auth.username")}
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <div className="login-field">
          <label htmlFor="login-password">{t("auth.password")}</label>
          <PasswordInput
            id="login-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="primary-btn" type="submit" disabled={pending}>
          {pending ? t("auth.signingIn") : t("auth.signIn")}
        </button>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
      <Link className="login-back" to="/">
        {t("auth.backToHome")}
      </Link>
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const location = useLocation();
  const [session, setSession] = useState<SessionState | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem(SIDEBAR_PINNED_KEY) === "true");
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const toggleSidebarPinned = () => {
    setSidebarPinned((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_PINNED_KEY, String(next));
      return next;
    });
  };

  const persistSession = useCallback((next: SessionState | null) => {
    setSession(next);
    tokenRef.current = next?.accessToken ?? null;
  }, []);

  const refreshToken = useCallback(async (): Promise<SessionState | null> => {
    try {
      const currentRole = session?.user.activeRole;
      const payload = currentRole ? { activeRole: currentRole } : {};

      const refreshed = await apiRequest<unknown>(
        "/auth/refresh",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      const nextSession = toSessionState(refreshed);

      persistSession(nextSession);
      return nextSession;
    } catch {
      persistSession(null);
      return null;
    }
  }, [session, persistSession]);

  const requestWithAuthRaw = useCallback(async (path: string, options: RequestInit): Promise<Response> => {
    const run = async (accessToken: string | undefined) => {
      const headers = new Headers(options.headers);
      if (accessToken) {
        headers.set("Authorization", `Bearer ${accessToken}`);
      }
      if (options.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      return fetch(`/api${path}`, {
        ...options,
        headers,
        credentials: "include"
      });
    };

    const first = await run(tokenRef.current ?? undefined);
    if (first.status !== 401) {
      return first;
    }

    const refreshed = await refreshToken();
    if (!refreshed) {
      throw new Error("Session expired. Please sign in again.");
    }

    return run(refreshed.accessToken);
  }, [refreshToken]);

  const requestWithAuth = useCallback(async <T,>(path: string, options: RequestInit): Promise<T> => {
    const response = await requestWithAuthRaw(path, options);
    return parseResponse<T>(response);
  }, [requestWithAuthRaw]);


  useEffect(() => {
    const bootstrap = async () => {
      localStorage.removeItem("sams.accessToken");
      await refreshToken();
      setIsBootstrapping(false);
    };

    void bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setLoginError(null);
    setLoginPending(true);

    try {
      const result = toSessionState(await apiRequest<unknown>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      }));

      persistSession(result);
    } catch (error) {
      const messageText = getErrorMessage(error);
      setLoginError(messageText);
      toast.error(messageText);
    } finally {
      setLoginPending(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest<{ message: string }>("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // Ignore network/logout errors and clear local session.
    } finally {
      persistSession(null);
      setLoginError(null);
    }
  };

  const handleRoleSwitch = async (nextRole: BackendRole) => {
    if (!session) {
      return;
    }

    try {
      const result = toSessionState(await requestWithAuth<unknown>("/auth/switch-role", {
        method: "POST",
        body: JSON.stringify({ activeRole: nextRole })
      }));

      persistSession(result);
    } catch (error) {
      setLoginError(getErrorMessage(error));
    }
  };

  if (isBootstrapping) {
    return (
      <div className="login-shell">
        <p>Loading session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={<LoginPage onLogin={handleLogin} pending={loginPending} error={loginError} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  const activeRole = session.user.activeRole;
  if (session.user.mustChangePassword && location.pathname !== "/settings") {
    return <Navigate to="/settings" replace />;
  }
  const canEditMasterData = masterDataWriteRoles.includes(activeRole);
  const navItems: Array<{ to: string; label: string; allow: UiRole[]; icon: React.ReactNode }> = [
    { to: "/dashboard", label: t("nav.dashboard"), icon: <LayoutDashboard size={20} />, allow: dashboardRoles },
    { to: "/attendance", label: t("nav.attendance"), icon: <CheckSquare size={20} />, allow: attendanceRoles },
    { to: "/manage", label: t("nav.masterData"), icon: <Database size={20} />, allow: manageRoles },
    { to: "/alerts", label: t("nav.whatsappAlerts"), icon: <MessageCircle size={20} />, allow: notificationRoles },
    { to: "/data", label: t("nav.importExport"), icon: <FileSpreadsheet size={20} />, allow: dataTransferRoles },
    { to: "/reports", label: t("nav.reports"), icon: <BarChartIcon size={20} />, allow: reportRoles },
    { to: "/audit-logs", label: t("nav.auditLogs"), icon: <ShieldAlert size={20} />, allow: auditRoles }
  ];

  const visibleNavItems = navItems.filter((item) => item.allow.includes(activeRole));
  const mobilePrimaryCount = 4;
  const mobileOverflowNavItems = visibleNavItems.slice(mobilePrimaryCount);
  const defaultPath = visibleNavItems[0]?.to ?? "/forbidden";
  const activeNavLabel =
    location.pathname.startsWith("/settings")
      ? t("nav.settings")
      : visibleNavItems.find((item) => location.pathname.startsWith(item.to))?.label ?? t("nav.dashboard");

  return (
    <div className="app-layout">
      <aside
        className={classNames("sidebar", (sidebarPinned || sidebarHovered) && "expanded")}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <LayoutDashboard size={20} />
          </div>
          {visibleNavItems.map((item, index) => (
            <Link
              key={item.to}
              to={item.to}
              className={classNames(
                "nav-item",
                location.pathname.startsWith(item.to) && "active",
                index >= mobilePrimaryCount && "mobile-overflow-item"
              )}
              data-tooltip={item.label}
              aria-label={item.label}
              onClick={() => setMobileMoreOpen(false)}
            >
              {item.icon}
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="sidebar-bottom">
          {settingsRoles.includes(activeRole) ? (
            <Link
              to="/settings"
              className={classNames("nav-item", "mobile-overflow-item", location.pathname.startsWith("/settings") && "active")}
              data-tooltip={t("nav.settings")}
              aria-label={t("nav.settings")}
              onClick={() => setMobileMoreOpen(false)}
            >
              <Settings size={20} />
              <span className="nav-label">{t("nav.settings")}</span>
            </Link>
          ) : null}
          <button
            type="button"
            className="nav-item mobile-overflow-item"
            data-tooltip={t("auth.logout")}
            aria-label={t("auth.logout")}
            onClick={() => {
              setMobileMoreOpen(false);
              handleLogout();
            }}
            style={{ color: "var(--danger)" }}
          >
            <LogOut size={20} />
            <span className="nav-label">{t("auth.logout")}</span>
          </button>
          <button
            type="button"
            className="sidebar-pin-btn"
            onClick={toggleSidebarPinned}
            data-tooltip={sidebarPinned ? t("nav.collapseSidebar") : t("nav.expandSidebar")}
            aria-label={sidebarPinned ? t("nav.collapseSidebar") : t("nav.expandSidebar")}
          >
            {sidebarPinned ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
          </button>
          <button
            type="button"
            className={classNames("mobile-more-btn", mobileMoreOpen && "active")}
            onClick={() => setMobileMoreOpen((prev) => !prev)}
            aria-label={t("nav.moreOptions")}
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
        {mobileMoreOpen ? (
          <>
            <div className="mobile-more-overlay open" onClick={() => setMobileMoreOpen(false)} />
            <div className="mobile-more-menu open">
              {mobileOverflowNavItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={classNames("nav-item", location.pathname.startsWith(item.to) && "active")}
                  onClick={() => setMobileMoreOpen(false)}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                </Link>
              ))}
              {settingsRoles.includes(activeRole) ? (
                <Link
                  to="/settings"
                  className={classNames("nav-item", location.pathname.startsWith("/settings") && "active")}
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <Settings size={20} />
                  <span className="nav-label">{t("nav.settings")}</span>
                </Link>
              ) : null}
              <button
                type="button"
                className="nav-item"
                onClick={() => {
                  setMobileMoreOpen(false);
                  handleLogout();
                }}
                style={{ color: "var(--danger)" }}
              >
                <LogOut size={20} />
                <span className="nav-label">{t("auth.logout")}</span>
              </button>
            </div>
          </>
        ) : null}
      </aside>

      <main className="main-wrapper">
        <header className="top-header">
          <div className="header-left">
            <h1 className="header-title">{activeNavLabel}</h1>
            <LayoutDashboard size={18} className="logo-icon" />
          </div>

          <div className="header-right">
            <select aria-label={t("common.language")} value={i18n.language} onChange={(event) => setLanguage(event.target.value as "en" | "hi")} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", outline: "none", cursor: "pointer", width: "auto", minWidth: 0, padding: 0 }}>
              <option value="en">EN</option>
              <option value="hi">HI</option>
            </select>

            {session.user.roles.length > 1 && (
              <select aria-label={t("common.role")} value={activeRole} onChange={(event) => handleRoleSwitch(event.target.value as BackendRole)} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", outline: "none", cursor: "pointer", width: "auto", minWidth: 0, padding: 0 }}>
                {session.user.roles.map((item) => (
                  <option value={item} key={item}>
                    {t(`roles.${roleTranslationKey[item]}`)}
                  </option>
                ))}
              </select>
            )}

            <div className="user-profile">
              <div className="user-info" style={{ textAlign: "right" }}>
                <span className="user-name">{session.user.fullName}</span>
                <span className="user-role">{t(`roles.${roleTranslationKey[session.user.activeRole]}`)}</span>
              </div>
              <div className="avatar">
                <Users size={20} />
              </div>
            </div>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to={defaultPath} replace />} />
          <Route
            path="/dashboard"
            element={
              <RoleGuard role={activeRole} allow={dashboardRoles}>
                <Dashboard role={activeRole} requestWithAuth={requestWithAuth} />
              </RoleGuard>
            }
          />
          <Route
            path="/attendance"
            element={
              <RoleGuard role={activeRole} allow={attendanceRoles}>
                <div className="page-content fade-in"><AttendancePage requestWithAuth={requestWithAuth} role={activeRole} /></div>
              </RoleGuard>
            }
          />
          <Route
            path="/reports"
            element={
              <RoleGuard role={activeRole} allow={reportRoles}>
                <div className="page-content fade-in"><ReportsPage requestWithAuth={requestWithAuth} requestWithAuthRaw={requestWithAuthRaw} /></div>
              </RoleGuard>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <RoleGuard role={activeRole} allow={auditRoles}>
                <div className="page-content fade-in"><AuditTimelinePage requestWithAuth={requestWithAuth} /></div>
              </RoleGuard>
            }
          />
          <Route
            path="/manage"
            element={
              <RoleGuard role={activeRole} allow={manageRoles}>
                <ManagePage requestWithAuth={requestWithAuth} canEdit={canEditMasterData} />
              </RoleGuard>
            }
          />
          <Route
            path="/alerts"
            element={
              <RoleGuard role={activeRole} allow={notificationRoles}>
                <NotificationsPage requestWithAuth={requestWithAuth} canGenerate={canEditMasterData} />
              </RoleGuard>
            }
          />
          <Route
            path="/data"
            element={
              <RoleGuard role={activeRole} allow={dataTransferRoles}>
                <DataTransferPage
                  requestWithAuth={requestWithAuth}
                  requestWithAuthRaw={requestWithAuthRaw}
                  canImport={canEditMasterData}
                />
              </RoleGuard>
            }
          />
          <Route
            path="/settings"
            element={
              <RoleGuard role={activeRole} allow={settingsRoles}>
                <SettingsPage
                  requestWithAuth={requestWithAuth}
                  canEdit={canEditMasterData}
                  forcePasswordChange={session.user.mustChangePassword}
                  onPasswordChanged={() => {
                    persistSession({
                      ...session,
                      user: { ...session.user, mustChangePassword: false }
                    });
                  }}
                />
              </RoleGuard>
            }
          />
          <Route path="/forbidden" element={<div className="page-content fade-in"><ForbiddenPage /></div>} />
          <Route path="*" element={<Navigate to={defaultPath} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
