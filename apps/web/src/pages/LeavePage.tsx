import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CalendarDays, Check, Clock3, Eye, MessageCircle, Plus, RefreshCw, Send, UserRoundCheck, X } from "lucide-react";
import { PageLoader } from "../components/Loader";
import { currentMonthRange, dateKeyToDisplay, displayDateToKey, todayDateKey } from "../lib/date";
import { useToast } from "../lib/toast";

export type LeaveRequest = <T>(path: string, options: RequestInit) => Promise<T>;
type Role = "admin" | "teacher";
type LeaveStatus = "pending" | "approved" | "partially_approved" | "rejected" | "withdrawn";

type LeaveItem = {
  _id: string;
  teacherId: string;
  teacherName: string;
  className: string;
  fromDate: string;
  toDate: string;
  fromDateLabel: string;
  toDateLabel: string;
  reason: string;
  status: LeaveStatus;
  requestedWorkingDays: number;
  approvedWorkingDays: number;
  approvedFromDateLabel?: string;
  approvedToDateLabel?: string;
  decisionNote?: string;
  createdAt: string;
  adminWhatsAppLink: string;
  teacherWhatsAppLink: string;
  hasAdminWhatsAppNumber?: boolean;
  hasTeacherWhatsAppNumber?: boolean;
};

type LeaveList = { items: LeaveItem[]; total: number; page: number; totalPages: number };
type TeacherOption = { _id: string; fullName: string };
type Analytics = {
  summary: Record<LeaveStatus, number> & { approvedLeaveDays: number; distinctTeachers: number };
  trend: Array<{ period: string; leaveDays: number }>;
  teachers: Array<{ teacherId: string; teacherName: string; className: string; approvedDays: number; decidedRequests: number }>;
};

const emptyAnalytics: Analytics = {
  summary: { approvedLeaveDays: 0, distinctTeachers: 0, pending: 0, approved: 0, partially_approved: 0, rejected: 0, withdrawn: 0 },
  trend: [],
  teachers: []
};

function openWhatsApp(link: string) {
  if (link) window.open(link, "_blank", "noopener,noreferrer");
}

function WhatsAppButton({ link, label, compact = false }: { link: string; label: string; compact?: boolean }) {
  if (!link) return null;
  return (
    <button
      type="button"
      className={compact ? "ghost-btn whatsapp-inline-btn" : "primary-btn whatsapp-btn"}
      onClick={() => openWhatsApp(link)}
    >
      <MessageCircle size={compact ? 15 : 16} />
      {label}
    </button>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
  required = false,
  minDate,
  maxDate
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minDate?: string;
  maxDate?: string;
}) {
  const { t } = useTranslation();
  const pickerRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
    } else {
      picker.click();
    }
  };

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}{required ? <span className="req">*</span> : null}</label>
      <div className="leave-date-control">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          maxLength={10}
          required={required}
        />
        <button
          type="button"
          className="leave-date-picker-btn"
          aria-label={t("leave.openCalendar", { field: label })}
          title={t("leave.openCalendar", { field: label })}
          onClick={openPicker}
        >
          <CalendarDays size={18} />
        </button>
        <input
          ref={pickerRef}
          className="leave-native-date-picker"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={displayDateToKey(value) ?? ""}
          min={minDate}
          max={maxDate}
          onChange={(event) => onChange(event.target.value ? dateKeyToDisplay(event.target.value) : "")}
        />
      </div>
    </div>
  );
}

export default function LeavePage({ role, requestWithAuth }: { role: Role; requestWithAuth: LeaveRequest }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<"applications" | "analytics">("applications");
  const [items, setItems] = useState<LeaveItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [applicationTeacherId, setApplicationTeacherId] = useState("");
  const [applicationFrom, setApplicationFrom] = useState("");
  const [applicationTo, setApplicationTo] = useState("");
  const [applicationFilters, setApplicationFilters] = useState({ teacherId: "", fromDate: "", toDate: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LeaveItem | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState<"approve" | "partially_approve" | "reject">("approve");
  const [approvedFromDate, setApprovedFromDate] = useState("");
  const [approvedToDate, setApprovedToDate] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [revokeNote, setRevokeNote] = useState("");
  const monthRange = currentMonthRange();
  const [analyticsFrom, setAnalyticsFrom] = useState(monthRange.fromDate);
  const [analyticsTo, setAnalyticsTo] = useState(monthRange.toDate);
  const [analyticsTeacherId, setAnalyticsTeacherId] = useState("");
  const [granularity, setGranularity] = useState<"day" | "month">("day");
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20", scope });
      if (status) query.set("status", status);
      if (applicationFilters.teacherId) query.set("teacherId", applicationFilters.teacherId);
      if (applicationFilters.fromDate) query.set("fromDate", applicationFilters.fromDate);
      if (applicationFilters.toDate) query.set("toDate", applicationFilters.toDate);
      const result = await requestWithAuth<LeaveList>(`/leaves?${query}`, { method: "GET" });
      setItems(result.items);
      setTotalPages(result.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("leave.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [applicationFilters, page, requestWithAuth, scope, status, t]);

  const loadAnalytics = useCallback(async () => {
    const fromKey = displayDateToKey(analyticsFrom);
    const toKey = displayDateToKey(analyticsTo);
    if (!fromKey || !toKey || fromKey > toKey) {
      setError(t("leave.invalidDate"));
      return;
    }
    setAnalyticsLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ fromDate: fromKey, toDate: toKey, granularity });
      if (analyticsTeacherId) query.set("teacherId", analyticsTeacherId);
      const result = await requestWithAuth<Analytics>(`/leaves/analytics?${query}`, { method: "GET" });
      setAnalytics(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("leave.analyticsFailed"));
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsFrom, analyticsTeacherId, analyticsTo, granularity, requestWithAuth, t]);

  useEffect(() => { void loadApplications(); }, [loadApplications]);
  useEffect(() => { if (role === "admin" && tab === "analytics") void loadAnalytics(); }, [loadAnalytics, role, tab]);
  useEffect(() => {
    if (role !== "admin") return;
    let active = true;
    void requestWithAuth<{ items: TeacherOption[] }>("/master-data/teachers", { method: "GET" })
      .then(({ items: teacherItems }) => { if (active) setTeachers(teacherItems); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : t("leave.loadFailed")); });
    return () => { active = false; };
  }, [requestWithAuth, role, t]);

  useEffect(() => {
    const requestId = searchParams.get("request");
    if (!requestId) return;
    let active = true;
    void requestWithAuth<{ item: LeaveItem }>(`/leaves/${requestId}`, { method: "GET" })
      .then(({ item }) => {
        if (active) {
          setSelected(item);
          setApprovedFromDate(dateKeyToDisplay(item.fromDate));
          setApprovedToDate(dateKeyToDisplay(item.toDate));
        }
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : t("leave.loadFailed")); });
    return () => { active = false; };
  }, [requestWithAuth, searchParams, t]);

  const closeDetails = () => {
    setSelected(null);
    setRevokeNote("");
    if (searchParams.has("request")) {
      const next = new URLSearchParams(searchParams);
      next.delete("request");
      setSearchParams(next, { replace: true });
    }
  };

  const submitApplication = async (event: FormEvent) => {
    event.preventDefault();
    const fromKey = displayDateToKey(fromDate);
    const toKey = displayDateToKey(toDate);
    if (!fromKey || !toKey || fromKey > toKey) {
      setError(t("leave.invalidDate"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await requestWithAuth<{ item: LeaveItem }>("/leaves", {
        method: "POST",
        body: JSON.stringify({ fromDate: fromKey, toDate: toKey, reason })
      });
      setFromDate(""); setToDate(""); setReason(""); setSelected(result.item);
      toast.success(t("leave.submitted"));
      await loadApplications();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : t("leave.submitFailed");
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  };

  const withdraw = async (item: LeaveItem) => {
    setSaving(true);
    try {
      await requestWithAuth(`/leaves/${item._id}/withdraw`, { method: "POST" });
      toast.success(t("leave.withdrawn")); closeDetails(); await loadApplications();
    } catch (withdrawError) {
      const message = withdrawError instanceof Error ? withdrawError.message : t("leave.actionFailed");
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  };

  const canCancel = (item: LeaveItem) =>
    item.status === "pending" || ((item.status === "approved" || item.status === "partially_approved") && item.fromDate > todayDateKey());

  const canRevoke = (item: LeaveItem) =>
    (item.status === "approved" || item.status === "partially_approved") && item.fromDate > todayDateKey();

  const revokeApproval = async (item: LeaveItem) => {
    if (!revokeNote.trim()) { setError(t("leave.revokeNoteRequired")); return; }
    setSaving(true); setError(null);
    try {
      const result = await requestWithAuth<{ item: LeaveItem }>(`/leaves/${item._id}/revoke`, { method: "POST", body: JSON.stringify({ note: revokeNote.trim() }) });
      setSelected(result.item); setRevokeNote(""); toast.success(t("leave.revoked")); await loadApplications();
    } catch (revokeError) {
      const message = revokeError instanceof Error ? revokeError.message : t("leave.actionFailed");
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  };

  const decide = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const payload: Record<string, string> = { decision };
    if (decisionNote.trim()) payload.note = decisionNote.trim();
    if (decision === "partially_approve") {
      const fromKey = displayDateToKey(approvedFromDate);
      const toKey = displayDateToKey(approvedToDate);
      if (!fromKey || !toKey || fromKey > toKey) { setError(t("leave.invalidDate")); return; }
      payload.approvedFromDate = fromKey; payload.approvedToDate = toKey;
    }
    setSaving(true); setError(null);
    try {
      const result = await requestWithAuth<{ item: LeaveItem }>(`/leaves/${selected._id}/decision`, { method: "POST", body: JSON.stringify(payload) });
      setSelected(result.item); setDecisionNote(""); toast.success(t("leave.decisionSaved")); await loadApplications();
    } catch (decisionError) {
      const message = decisionError instanceof Error ? decisionError.message : t("leave.actionFailed");
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  };

  const showDetails = (item: LeaveItem) => {
    setSelected(item); setApprovedFromDate(dateKeyToDisplay(item.fromDate)); setApprovedToDate(dateKeyToDisplay(item.toDate)); setRevokeNote("");
  };

  const applyApplicationFilters = () => {
    const fromKey = applicationFrom ? displayDateToKey(applicationFrom) : "";
    const toKey = applicationTo ? displayDateToKey(applicationTo) : "";
    if ((applicationFrom && !fromKey) || (applicationTo && !toKey) || (fromKey && toKey && fromKey > toKey)) {
      setError(t("leave.invalidDate"));
      return;
    }
    setError(null);
    setPage(1);
    setApplicationFilters({ teacherId: applicationTeacherId, fromDate: fromKey ?? "", toDate: toKey ?? "" });
  };

  return (
    <div className="page-content fade-in leave-page">
      <div className="page-title-wrap">
        <h2>{t("leave.title")}</h2>
        <span className="active-crumb">{t(role === "admin" ? "leave.adminCrumb" : "leave.teacherCrumb")}</span>
      </div>

      {role === "admin" ? (
        <div className="manage-tabs">
          <button className={`tab-btn ${tab === "applications" ? "active" : ""}`} onClick={() => setTab("applications")}>
            <CalendarDays size={16} />{t("leave.applications")}
          </button>
          <button className={`tab-btn ${tab === "analytics" ? "active" : ""}`} onClick={() => setTab("analytics")}>
            <BarChart3 size={16} />{t("leave.analytics")}
          </button>
        </div>
      ) : null}

      {role === "teacher" ? (
        <section className="table-panel leave-application-panel">
          <div className="table-header">
            <div>
              <h2 className="panel-title"><Plus size={16} />{t("leave.apply")}</h2>
              <p className="panel-subtitle">{t("leave.applyHint")}</p>
            </div>
          </div>
          <form className="leave-application-form" onSubmit={submitApplication}>
            <DateField id="leave-from" label={t("leave.from")} value={fromDate} onChange={setFromDate} minDate={todayDateKey()} required />
            <DateField id="leave-to" label={t("leave.to")} value={toDate} onChange={setToDate} minDate={displayDateToKey(fromDate) ?? todayDateKey()} required />
            <div className="form-field leave-reason">
              <label htmlFor="leave-reason">{t("leave.reason")}<span className="req">*</span></label>
              <textarea id="leave-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required />
            </div>
            <button className="primary-btn" disabled={saving} type="submit">
              <Send size={16} />{saving ? t("leave.saving") : t("leave.submit")}
            </button>
          </form>
        </section>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      {tab === "applications" ? (
        <section className="table-panel leave-applications-panel">
          <div className="table-header">
            <div className="leave-header-title">
              <h2 className="panel-title">{t("leave.applications")}</h2>
              <p className="panel-subtitle">{t("leave.listHint")}</p>
            </div>
            <div className="manage-tabs leave-scope-toggle">
              {(["upcoming", "past"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`tab-btn ${scope === value ? "active" : ""}`}
                  onClick={() => { setScope(value); setPage(1); }}
                >
                  {t(`leave.scope.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="leave-filters-wrapper">
            <div className="table-controls leave-list-filters">
              {role === "admin" ? (
                <>
                  <label className="master-data-control">
                    <span>{t("leave.teacher")}</span>
                    <select aria-label={t("leave.teacher")} value={applicationTeacherId} onChange={(event) => setApplicationTeacherId(event.target.value)}>
                      <option value="">{t("leave.allTeachers")}</option>
                      {teachers.map((teacher) => <option key={teacher._id} value={teacher._id}>{teacher.fullName}</option>)}
                    </select>
                  </label>
                  <DateField id="application-filter-from" label={t("leave.from")} value={applicationFrom} onChange={setApplicationFrom} />
                  <DateField id="application-filter-to" label={t("leave.to")} value={applicationTo} onChange={setApplicationTo} />
                </>
              ) : null}
              <label className="master-data-control">
                <span>{t("leave.statusLabel")}</span>
                <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                  <option value="">{t("leave.allStatuses")}</option>
                  {(["pending", "approved", "partially_approved", "rejected", "withdrawn"] as LeaveStatus[]).map((value) => (
                    <option key={value} value={value}>{t(`leave.status.${value}`)}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="leave-filter-actions">
              {role === "admin" ? <button className="ghost-btn" onClick={applyApplicationFilters}>{t("leave.applyFilters")}</button> : null}
              <button className="icon-btn" onClick={() => void loadApplications()} title={t("leave.refresh")} aria-label={t("leave.refresh")}>
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {loading ? (
            <PageLoader label={t("leave.loading")} />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {role === "admin" ? <th>{t("leave.teacher")}</th> : null}
                    <th>{t("leave.dates")}</th>
                    <th>{t("leave.days")}</th>
                    <th>{t("leave.reason")}</th>
                    <th>{t("leave.statusLabel")}</th>
                    <th>{t("leave.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item._id}>
                      {role === "admin" ? (
                        <td>
                          <strong>{item.teacherName}</strong>
                          <small className="leave-cell-subtitle">{item.className || "-"}</small>
                        </td>
                      ) : null}
                      <td>{item.fromDateLabel}<br />{item.toDateLabel}</td>
                      <td>{item.status === "approved" || item.status === "partially_approved" ? item.approvedWorkingDays : item.requestedWorkingDays}</td>
                      <td className="leave-reason-cell">{item.reason}</td>
                      <td><span className={`status-badge leave-${item.status}`}>{t(`leave.status.${item.status}`)}</span></td>
                      <td>
                        <div className="row-actions leave-row-actions">
                          <button type="button" className="icon-btn" onClick={() => showDetails(item)} title={t("leave.view")} aria-label={t("leave.view")}>
                            <Eye size={16} />
                          </button>
                          {role === "teacher" && item.status === "pending" ? (
                            <WhatsAppButton compact link={item.adminWhatsAppLink} label={item.hasAdminWhatsAppNumber ? t("leave.whatsappAdmin") : t("leave.shareWhatsApp")} />
                          ) : null}
                          {role === "admin" && item.teacherWhatsAppLink ? (
                            <WhatsAppButton compact link={item.teacherWhatsAppLink} label={item.hasTeacherWhatsAppNumber ? t("leave.whatsappTeacher") : t("leave.shareWhatsApp")} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 ? (
                    <tr><td colSpan={role === "admin" ? 6 : 5} className="empty-state">{t("leave.empty")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination-bar">
            <button className="ghost-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("common.previous")}</button>
            <span>{t("leave.pageOf", { page, totalPages })}</span>
            <button className="ghost-btn" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t("common.next")}</button>
          </div>
        </section>
      ) : null}

      {role === "admin" && tab === "analytics" ? (
        <div className="leave-analytics-stack">
          <section className="table-panel leave-analytics-filters-panel">
            <div className="table-header">
              <h2 className="panel-title">{t("leave.analyticsFilters")}</h2>
            </div>
            <div className="leave-filters-wrapper">
              <div className="table-controls leave-list-filters">
                <label className="master-data-control">
                  <span>{t("leave.teacher")}</span>
                  <select aria-label={t("leave.teacher")} value={analyticsTeacherId} onChange={(event) => setAnalyticsTeacherId(event.target.value)}>
                    <option value="">{t("leave.allTeachers")}</option>
                    {teachers.map((teacher) => <option key={teacher._id} value={teacher._id}>{teacher.fullName}</option>)}
                  </select>
                </label>
                <DateField id="analytics-from" label={t("leave.from")} value={analyticsFrom} onChange={setAnalyticsFrom} />
                <DateField id="analytics-to" label={t("leave.to")} value={analyticsTo} onChange={setAnalyticsTo} />
                <label className="master-data-control">
                  <span>{t("leave.granularity")}</span>
                  <select value={granularity} onChange={(event) => setGranularity(event.target.value as "day" | "month")}>
                    <option value="day">{t("leave.daily")}</option>
                    <option value="month">{t("leave.monthly")}</option>
                  </select>
                </label>
              </div>
              <div className="leave-filter-actions">
                <button className="primary-btn" onClick={() => void loadAnalytics()}>{t("leave.applyFilters")}</button>
              </div>
            </div>
          </section>

          {analyticsLoading ? (
            <PageLoader label={t("leave.loadingAnalytics")} />
          ) : (
            <>
              <div className="stat-grid leave-stat-grid">
                {[
                  [t("leave.approvedDays"), analytics.summary.approvedLeaveDays, <CalendarDays key="approved-days" size={18} />],
                  [t("leave.teachersOnLeave"), analytics.summary.distinctTeachers, <UserRoundCheck key="teachers-on-leave" size={18} />],
                  [t("leave.pending"), analytics.summary.pending, <Clock3 key="pending-applications" size={18} />]
                ].map(([label, value, icon]) => (
                  <article className="stat-card" key={String(label)}>
                    <div className="stat-header">
                      <span className="stat-title">{label}</span>
                      <span className="stat-icon">{icon}</span>
                    </div>
                    <strong className="stat-value">{value}</strong>
                  </article>
                ))}
              </div>

              <div className="charts-grid">
                <section className="chart-panel">
                  <div className="panel-header"><h3>{t("leave.trend")}</h3></div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={analytics.trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="period" tickFormatter={(value) => granularity === "day" ? dateKeyToDisplay(value) : value} />
                      <YAxis allowDecimals={false} />
                      <Tooltip labelFormatter={(value) => granularity === "day" ? dateKeyToDisplay(String(value)) : value} />
                      <Bar dataKey="leaveDays" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </section>
                <section className="table-panel leave-analytics-table">
                  <div className="table-header">
                    <h2 className="panel-title">{t("leave.byTeacher")}</h2>
                  </div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t("leave.teacher")}</th>
                          <th>{t("leave.days")}</th>
                          <th>{t("leave.requests")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.teachers.map((teacher) => (
                          <tr key={teacher.teacherId}>
                            <td>{teacher.teacherName}<small className="leave-cell-subtitle">{teacher.className || "-"}</small></td>
                            <td>{teacher.approvedDays}</td>
                            <td>{teacher.decidedRequests}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      ) : null}

      {selected ? (
        <div className="modal-backdrop" onClick={closeDetails}>
          <div className="modal-card leave-detail-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-section">
                <h2>{selected.teacherName}</h2>
                <p className="panel-subtitle">{selected.fromDateLabel} - {selected.toDateLabel}</p>
              </div>
              <button className="icon-btn" onClick={closeDetails} aria-label={t("common.close")}><X size={16} /></button>
            </div>

            <div className="modal-body">
              <section className="modal-details-section">
                <dl className="leave-detail-list">
                  <div className="leave-detail-item">
                    <dt>{t("leave.statusLabel")}</dt>
                    <dd><span className={`status-badge leave-${selected.status}`}>{t(`leave.status.${selected.status}`)}</span></dd>
                  </div>
                  <div className="leave-detail-item">
                    <dt>{t("leave.reason")}</dt>
                    <dd className="leave-detail-reason">{selected.reason}</dd>
                  </div>
                  <div className="leave-detail-item">
                    <dt>{t("leave.requestedDays")}</dt>
                    <dd>{selected.requestedWorkingDays}</dd>
                  </div>
                  {selected.approvedWorkingDays ? (
                    <div className="leave-detail-item">
                      <dt>{t("leave.approvedRange")}</dt>
                      <dd>{selected.approvedFromDateLabel} - {selected.approvedToDateLabel} ({selected.approvedWorkingDays})</dd>
                    </div>
                  ) : null}
                  {selected.decisionNote ? (
                    <div className="leave-detail-item">
                      <dt>{t("leave.adminNote")}</dt>
                      <dd className="leave-detail-reason">{selected.decisionNote}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {role === "admin" && selected.status === "pending" ? (
                <section className="modal-action-section leave-decision-section">
                  <h3 className="section-title">{t("leave.decisionTitle") || "Leave Decision"}</h3>
                  <form className="leave-decision-form" onSubmit={decide}>
                    <div className="decision-buttons">
                      <div className="manage-tabs">
                        {(["approve", "partially_approve", "reject"] as const).map((value) => (
                          <button key={value} type="button" className={`tab-btn ${decision === value ? "active" : ""}`} onClick={() => setDecision(value)}>
                            {value === "reject" ? <X size={15} /> : <Check size={15} />}{t(`leave.decision.${value}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {decision === "partially_approve" ? (
                      <div className="form-grid leave-date-grid">
                        <DateField id="approved-from" label={t("leave.approvedFrom")} value={approvedFromDate} onChange={setApprovedFromDate} minDate={selected.fromDate} maxDate={selected.toDate} required />
                        <DateField id="approved-to" label={t("leave.approvedTo")} value={approvedToDate} onChange={setApprovedToDate} minDate={selected.fromDate} maxDate={selected.toDate} required />
                      </div>
                    ) : null}
                    <div className="form-field">
                      <label htmlFor="decision-note">{t("leave.adminNoteOptional")}</label>
                      <textarea id="decision-note" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} maxLength={1000} placeholder={t("leave.adminNotePlaceholder") || "Add optional note..."} />
                    </div>
                    <button className="primary-btn" disabled={saving} type="submit">{saving ? t("leave.saving") : t("leave.saveDecision")}</button>
                  </form>
                </section>
              ) : null}

              {role === "admin" && canRevoke(selected) ? (
                <section className="modal-action-section leave-revoke-section">
                  <h3 className="section-title">{t("leave.rejectApproved")}</h3>
                  <form className="leave-decision-form" onSubmit={(event) => { event.preventDefault(); void revokeApproval(selected); }}>
                    <div className="form-field">
                      <label htmlFor="revoke-note">{t("leave.revokeNoteLabel")}<span className="req">*</span></label>
                      <textarea id="revoke-note" value={revokeNote} onChange={(event) => setRevokeNote(event.target.value)} maxLength={1000} minLength={3} required placeholder={t("leave.revokeNotePlaceholder") || "Enter reason for rejection..."} />
                    </div>
                    <button className="primary-btn danger-text" disabled={saving || !revokeNote.trim()} type="submit">
                      <X size={15} />{saving ? t("leave.saving") : t("leave.rejectApproved")}
                    </button>
                  </form>
                </section>
              ) : null}

              {role === "admin" && !canRevoke(selected) && (selected.status === "approved" || selected.status === "partially_approved") ? (
                <section className="modal-message-section">
                  <p className="panel-subtitle leave-revoke-hint">{t("leave.revokeUnavailable")}</p>
                </section>
              ) : null}
            </div>

            {(role === "teacher" && canCancel(selected)) || (role === "admin" && selected.teacherWhatsAppLink) ? (
              <div className="modal-footer">
                <div className="modal-footer-actions">
                  {role === "teacher" && canCancel(selected) ? (
                    <button type="button" className="ghost-btn danger-text" disabled={saving} onClick={() => void withdraw(selected)}>
                      {selected.status === "pending" ? t("leave.withdraw") : t("leave.cancelLeave")}
                    </button>
                  ) : null}
                  {role === "teacher" && selected.status === "pending" ? (
                    <WhatsAppButton link={selected.adminWhatsAppLink} label={selected.hasAdminWhatsAppNumber ? t("leave.messageAdmin") : t("leave.shareWhatsApp")} />
                  ) : null}
                  {role === "admin" && selected.teacherWhatsAppLink ? (
                    <WhatsAppButton link={selected.teacherWhatsAppLink} label={selected.hasTeacherWhatsAppNumber ? t("leave.notifyTeacher") : t("leave.shareWhatsApp")} />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
