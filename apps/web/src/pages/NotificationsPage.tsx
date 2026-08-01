import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle, Clock, MessageCircle, RefreshCw, SkipForward } from "lucide-react";
import { useToast } from "../lib/toast";
import type { ManageRequest } from "./ManagePage";

type NotificationState = "pending" | "sent" | "failed" | "skipped";
type NotificationStatus = "absent" | "late" | "half_day";

type NotificationItem = {
  _id: string;
  studentName: string;
  teacherName?: string;
  className?: string;
  parentName?: string;
  phoneNumber?: string;
  status: NotificationStatus;
  state: NotificationState;
  attendanceDate: string;
  messageEn: string;
  messageHi: string;
  waLink: string;
  waLinkEn: string;
  waLinkHi: string;
  sentAt?: string | null;
};

type ListResponse = {
  items: NotificationItem[];
  total: number;
  page: number;
  totalPages: number;
};

type SummaryResponse = {
  summary: { pending: number; sent: number; failed: number; skipped: number; total: number };
};

type GenerateResponse = { attendanceRecords: number; created: number; updated: number };

const PAGE_SIZE = 15;

const stateFilters: Array<"all" | NotificationState> = ["pending", "sent", "skipped", "all"];

const stateTone: Record<NotificationState, string> = {
  pending: "warning",
  sent: "success",
  failed: "danger",
  skipped: "muted"
};

function todayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

type NotificationsPageProps = {
  requestWithAuth: ManageRequest;
  canGenerate: boolean;
};

export default function NotificationsPage({ requestWithAuth, canGenerate }: NotificationsPageProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const [date, setDate] = useState(todayIso());
  const [stateFilter, setStateFilter] = useState<"all" | NotificationState>("pending");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [summary, setSummary] = useState<SummaryResponse["summary"] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const columnCount = canGenerate ? 8 : 6;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ date, page: String(page), pageSize: String(PAGE_SIZE) });
      if (stateFilter !== "all") {
        query.set("state", stateFilter);
      }

      const [list, summaryResponse] = await Promise.all([
        requestWithAuth<ListResponse>(`/notifications?${query.toString()}`, { method: "GET" }),
        requestWithAuth<SummaryResponse>(`/notifications/summary?date=${date}`, { method: "GET" })
      ]);

      setItems(list.items);
      setTotal(list.total);
      setTotalPages(list.totalPages);
      setSummary(summaryResponse.summary);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [date, page, requestWithAuth, stateFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [date, stateFilter]);

  const updateState = async (id: string, nextState: NotificationState) => {
    setBusyId(id);
    setError("");
    try {
      await requestWithAuth(`/notifications/${id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ state: nextState })
      });
      await load();
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    } finally {
      setBusyId(null);
    }
  };

  const openWhatsApp = (item: NotificationItem) => {
    const link = item.waLink;
    if (!link) {
      setError(t("alerts.noPhone", { name: item.studentName }));
      return;
    }

    window.open(link, "_blank", "noopener,noreferrer");
    void updateState(item._id, "sent");
  };

  const markAllVisibleSent = async () => {
    const ids = items.filter((item) => item.state === "pending" && item.phoneNumber).map((item) => item._id);
    if (ids.length === 0) {
      return;
    }

    setError("");
    try {
      await requestWithAuth("/notifications/bulk-state", {
        method: "POST",
        body: JSON.stringify({ ids, state: "sent" })
      });
      setNotice(t("alerts.markedSent", { count: ids.length }));
      toast.success(t("alerts.markedSent", { count: ids.length }));
      await load();
    } catch (bulkError) {
      const message = getErrorMessage(bulkError);
      setError(message);
      toast.error(message);
    }
  };

  const regenerate = async () => {
    setError("");
    setNotice("");
    try {
      const result = await requestWithAuth<GenerateResponse>("/notifications/generate", {
        method: "POST",
        body: JSON.stringify({ date })
      });
      setNotice(t("alerts.rebuilt", { records: result.attendanceRecords, created: result.created, updated: result.updated }));
      toast.success(t("alerts.rebuilt", { records: result.attendanceRecords, created: result.created, updated: result.updated }));
      await load();
    } catch (generateError) {
      const message = getErrorMessage(generateError);
      setError(message);
      toast.error(message);
    }
  };

  const summaryChips = useMemo(
    () =>
      summary
        ? [
            { key: "pending", label: t("alerts.pending"), value: summary.pending, tone: "warning" },
            { key: "sent", label: t("alerts.sent"), value: summary.sent, tone: "success" },
            { key: "skipped", label: t("alerts.skipped"), value: summary.skipped, tone: "muted" },
            { key: "total", label: t("alerts.total"), value: summary.total, tone: "accent" }
          ]
        : [],
    [summary, t]
  );

  return (
    <div className="page-content fade-in">
      <div className="page-title-wrap">
        <h2>{t("alerts.title")}</h2>
        <p className="panel-subtitle">
          {t("alerts.subtitle")}
        </p>
      </div>

      {summary ? (
        <div className="alert-summary">
          {summaryChips.map((chip) => (
            <div key={chip.key} className={`alert-stat tone-${chip.tone}`}>
              <span className="alert-stat-value">{chip.value}</span>
              <span className="alert-stat-label">{chip.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <section className="table-panel">
        <div className="table-header">
          <div className="alert-filters">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <div className="manage-tabs">
              {stateFilters.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`tab-btn${stateFilter === filter ? " active" : ""}`}
                  onClick={() => setStateFilter(filter)}
                >
                  {t(`alerts.${filter}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-actions">
            {canGenerate ? (
              <button type="button" className="ghost-btn" onClick={() => void regenerate()}>
                <RefreshCw size={15} /> {t("alerts.rebuild")}
              </button>
            ) : null}
            <button type="button" className="primary-btn" onClick={() => void markAllVisibleSent()} disabled={loading}>
              <CheckCircle size={15} /> {t("alerts.markPageSent")}
            </button>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {notice ? <p className="success-text">{notice}</p> : null}

        <div className="table-scroll alerts-table-wrap">
          <table className={`data-table alerts-table${canGenerate ? " is-admin" : ""}`}>
            <thead>
              <tr>
                <th className="alerts-col-student">{t("alerts.colStudent")}</th>
                {canGenerate ? <th className="alerts-col-teacher">{t("alerts.colTeacher")}</th> : null}
                {canGenerate ? <th className="alerts-col-class alerts-center-cell">{t("alerts.colClass")}</th> : null}
                <th className="alerts-col-status alerts-center-cell">{t("alerts.colStatus")}</th>
                <th className="alerts-col-parent">{t("alerts.colParent")}</th>
                <th className="alerts-col-phone">{t("alerts.colPhone")}</th>
                <th className="alerts-col-alert alerts-center-cell">{t("alerts.colAlert")}</th>
                <th className="alerts-col-actions alerts-center-cell">{t("alerts.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columnCount}>{t("alerts.loading")}</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={columnCount}>
                    <div className="empty-state">
                      <MessageCircle size={28} />
                      <p>{t("alerts.empty")}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item._id}>
                    <td data-label={t("alerts.colStudent")}>{item.studentName}</td>
                    {canGenerate ? <td className="alerts-nowrap" data-label={t("alerts.colTeacher")}>{item.teacherName ?? "-"}</td> : null}
                    {canGenerate ? <td className="alerts-center-cell alerts-nowrap" data-label={t("alerts.colClass")}>{item.className ?? "-"}</td> : null}
                    <td className="alerts-center-cell" data-label={t("alerts.colStatus")}>
                      <span className="status-badge">
                        {item.status === "absent" ? <AlertTriangle size={13} /> : <Clock size={13} />}
                        {t(item.status === "half_day" ? "attendance.status.halfDay" : `attendance.status.${item.status}`)}
                      </span>
                    </td>
                    <td data-label={t("alerts.colParent")}>{item.parentName || <span className="muted">{t("alerts.notLinked")}</span>}</td>
                    <td data-label={t("alerts.colPhone")}>{item.phoneNumber || <span className="muted">{t("alerts.missing")}</span>}</td>
                    <td className="alerts-center-cell" data-label={t("alerts.colAlert")}>
                      <span className={`state-pill tone-${stateTone[item.state]}`}>{t(`alerts.${item.state}`)}</span>
                    </td>
                    <td className="alerts-actions-cell" data-label={t("alerts.colActions")}>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="wa-btn"
                          onClick={() => openWhatsApp(item)}
                          disabled={busyId === item._id || !item.phoneNumber}
                          title={t("alerts.openWhatsApp")}
                        >
                          <MessageCircle size={15} /> {t("alerts.whatsapp")}
                        </button>
                        {item.state === "pending" ? (
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => void updateState(item._id, "skipped")}
                            disabled={busyId === item._id}
                            title={t("alerts.skipAlert")}
                          >
                            <SkipForward size={15} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <span className="muted">
            {total} {total === 1 ? t("alerts.alertSingular") : t("alerts.alertPlural")}
          </span>
          <div className="row-actions">
            <button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              {t("common.previous")}
            </button>
            <span className="muted">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="ghost-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
