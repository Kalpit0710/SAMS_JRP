import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crosshair,
  History,
  LockKeyhole,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Users
} from "lucide-react";

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

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
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
  isAdmin
}: {
  requestWithAuth: RequestWithAuth;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "capturing" | "captured" | "error" | "out_of_range">("idle");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [capturedLocation, setCapturedLocation] = useState<GeolocationPosition | null>(null);
  const [hasStartedAutoCapture, setHasStartedAutoCapture] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isAdmin) {
        const [result, policy] = await Promise.all([
          requestWithAuth<{ rows: OverviewRow[] }>("/teacher-attendance/admin/overview", { method: "GET" }),
          requestWithAuth<Settings>("/teacher-attendance/settings", { method: "GET" })
        ]);
        setOverview(result.rows);
        setSettings(policy);
      } else {
        const result = await requestWithAuth<{ items: AttendanceRecord[] }>("/teacher-attendance/me?pageSize=30", { method: "GET" });
        setRecords(result.items);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("teacherAttendance.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, requestWithAuth, t]);

  useEffect(() => {
    void load();
    if (isAdmin) return;
    void requestWithAuth<Settings>("/teacher-attendance/settings", { method: "GET" }).then(setSettings).catch(() => undefined);
  }, [isAdmin, load, requestWithAuth]);

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

  if (isAdmin) {
    const summary = {
      total: overview.length,
      onTime: overview.filter((row) => row.status === "on_time").length,
      late: overview.filter((row) => row.status === "late").length,
      missed: overview.filter((row) => row.status === "missed").length
    };

    return (
      <div className="page-content fade-in ta-page">
        <header className="ta-hero">
          <div className="ta-hero-text">
            <span className="eyebrow">{t("teacherAttendance.adminEyebrow")}</span>
            <h2>{t("teacherAttendance.adminTitle")}</h2>
            <p>{t("teacherAttendance.adminHint")}</p>
          </div>
          <span className="ta-date-chip"><CalendarDays size={14} aria-hidden="true" />{formatDate(todayKey())}</span>
        </header>

        {error ? <div className="ta-banner danger" role="alert"><ShieldAlert size={18} aria-hidden="true" /><p>{error}</p></div> : null}
        {notice ? <div className="ta-banner success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><p>{notice}</p></div> : null}

        <div className="ta-stat-grid">
          <div className="ta-stat"><span className="ta-stat-label"><Users size={14} aria-hidden="true" />{t("teacherAttendance.totalTeachers")}</span><strong>{summary.total}</strong></div>
          <div className="ta-stat success"><span className="ta-stat-label">{t("teacherAttendance.onTime")}</span><strong>{summary.onTime}</strong></div>
          <div className="ta-stat warning"><span className="ta-stat-label">{t("teacherAttendance.lateCount")}</span><strong>{summary.late}</strong></div>
          <div className="ta-stat danger"><span className="ta-stat-label">{t("teacherAttendance.missedCount")}</span><strong>{summary.missed}</strong></div>
        </div>

        {settings ? (
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

        <section className="ta-card">
          <div className="ta-card-header">
            <div className="ta-card-title">
              <span className="ta-card-icon"><Users size={18} aria-hidden="true" /></span>
              <div><h3>{t("teacherAttendance.dailyRecords")}</h3><p>{t("teacherAttendance.dailyRecordsHint")}</p></div>
            </div>
            <span className="ta-count-chip">{overview.length} {t("teacherAttendance.records")}</span>
          </div>

          {overview.length === 0 ? (
            <div className="ta-empty"><Users size={26} aria-hidden="true" /><p>{t("teacherAttendance.noRecords")}</p></div>
          ) : (
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
          )}
        </section>
      </div>
    );
  }

  const todayRecord = records.find((record) => record.attendanceDate === todayKey());
  const attendanceDisabled = settings?.enabled === false;
  const historyRecords = records;

  return (
    <div className="page-content fade-in ta-page">
      <header className="ta-hero">
        <div className="ta-hero-text">
          <span className="eyebrow">{t("teacherAttendance.teacherEyebrow")}</span>
          <h2>{t("teacherAttendance.title")}</h2>
          <p>{t("teacherAttendance.hint")}</p>
        </div>
        <span className="ta-date-chip"><CalendarDays size={14} aria-hidden="true" />{formatDate(todayKey())}</span>
      </header>

      {error ? <div className="ta-banner danger" role="alert"><ShieldAlert size={18} aria-hidden="true" /><p>{error}</p></div> : null}
      {notice ? <div className="ta-banner success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><p>{notice}</p></div> : null}

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
      </section>

      <section className="ta-card">
        <div className="ta-card-header">
          <div className="ta-card-title">
            <span className="ta-card-icon"><History size={18} aria-hidden="true" /></span>
            <div><h3>{t("teacherAttendance.history")}</h3></div>
          </div>
          <span className="ta-count-chip">{historyRecords.length} {t("teacherAttendance.records")}</span>
        </div>

        {historyRecords.length === 0 ? (
          <div className="ta-empty"><History size={26} aria-hidden="true" /><p>{t("teacherAttendance.noRecords")}</p></div>
        ) : (
          <ul className="ta-row-list">
            {historyRecords.map((record) => (
              <li className={`ta-row ${record.attendanceDate === todayKey() ? "is-today" : ""}`} key={record._id}>
                <div className="ta-row-main">
                  <span className="ta-avatar date" aria-hidden="true"><CalendarDays size={16} /></span>
                  <div className="ta-row-text">
                    <strong className="ta-row-title"><span className="ta-row-date">{formatDate(record.attendanceDate)}</span>{record.attendanceDate === todayKey() ? <span className="ta-today-tag">{t("teacherAttendance.todayTag")}</span> : null}</strong>
                    <small>{t("teacherAttendance.checkIn")}: {formatTime(record.checkInAtServer)}</small>
                  </div>
                </div>
                <span className={`status-badge ${statusTone(record.status)}`}>{t(`teacherAttendance.status.${record.status}`, { defaultValue: record.status })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
