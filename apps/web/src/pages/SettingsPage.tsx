import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { BellRing, Clock, KeyRound, LayoutDashboard, Lock, ShieldCheck, Archive } from "lucide-react";
import { PageLoader } from "../components/Loader";
import { PasswordInput } from "../components/PasswordInput";
import { DEFAULT_REPORT_DAYS_KEY } from "../lib/preferences";
import { TOASTS_ENABLED_KEY, useToast } from "../lib/toast";

export type SettingsRequest = <T>(path: string, options: RequestInit) => Promise<T>;

/** Matches NEVER_LOCK_MINUTES on the API (365 days). */
const NEVER_LOCK_MINUTES = 365 * 24 * 60;

const lockOptions = [
  { value: 15, labelKey: "settings.lock15" },
  { value: 30, labelKey: "settings.lock30" },
  { value: 60, labelKey: "settings.lock1h" },
  { value: 120, labelKey: "settings.lock2h" },
  { value: 360, labelKey: "settings.lock6h" },
  { value: 720, labelKey: "settings.lock12h" },
  { value: 1440, labelKey: "settings.lock24h" },
  { value: NEVER_LOCK_MINUTES, labelKey: "settings.lockNever" }
];

const reportDaysOptions = [7, 14, 30, 60, 90];

function describeLock(minutes: number, t: TFunction): string {
  if (minutes >= NEVER_LOCK_MINUTES) {
    return t("settings.lockDescNever");
  }

  if (minutes === 0) {
    return t("settings.lockDescImmediate");
  }

  const match = lockOptions.find((option) => option.value === minutes);
  const window = match ? t(match.labelKey) : t("settings.minutesLabel", { minutes });
  return t("settings.lockDescWindow", { window });
}

export function SettingsPage({
  requestWithAuth,
  canEdit,
  credentialType,
  forcePasswordChange = false,
  onPasswordChanged
}: {
  requestWithAuth: SettingsRequest;
  canEdit: boolean;
  credentialType: "password" | "pin";
  forcePasswordChange?: boolean;
  onPasswordChanged?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const usesPin = credentialType === "pin";
  const credentialCopy = usesPin
    ? {
        title: t("settings.changePinTitle"),
        description: t("settings.changePinDesc"),
        current: t("settings.currentPin"),
        next: t("settings.newPin"),
        confirm: t("settings.confirmPin"),
        update: t("settings.updatePin"),
        tooShort: t("settings.pinTooShort"),
        mismatch: t("settings.pinMismatch"),
        updated: t("settings.pinUpdated"),
        updateFailed: t("settings.pinUpdateFailed")
      }
    : {
        title: t("settings.changePasswordTitle"),
        description: t("settings.changePasswordDesc"),
        current: t("settings.currentPassword"),
        next: t("settings.newPassword"),
        confirm: t("settings.confirmPassword"),
        update: t("settings.updatePassword"),
        tooShort: t("settings.passwordTooShort"),
        mismatch: t("settings.passwordMismatch"),
        updated: t("settings.passwordUpdated"),
        updateFailed: t("settings.passwordUpdateFailed")
      };
  const [lockMinutes, setLockMinutes] = useState(60);
  const [savedMinutes, setSavedMinutes] = useState(60);
  const [academicYearStartMonth, setAcademicYearStartMonth] = useState(4);
  const [academicYearStartDay, setAcademicYearStartDay] = useState(1);
  const [retentionDays, setRetentionDays] = useState(2);
  const [archiveYear, setArchiveYear] = useState("");
  const [archivePreview, setArchivePreview] = useState<{ studentCount: number; attendanceCount: number } | null>(null);
  const [archivePreviewing, setArchivePreviewing] = useState(false);
  const [archiveFinalizing, setArchiveFinalizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toastsEnabled, setToastsEnabled] = useState(() => localStorage.getItem(TOASTS_ENABLED_KEY) !== "false");
  const [defaultReportDays, setDefaultReportDays] = useState(
    () => Number(localStorage.getItem(DEFAULT_REPORT_DAYS_KEY) ?? 30)
  );
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  const [pinSaving, setPinSaving] = useState(false);

  const changePin = async (event: FormEvent) => {
    event.preventDefault();
    setPinError(null);
    setPinNotice(null);

    if (newPin.length < 4) {
      setPinError(credentialCopy.tooShort);
      return;
    }
    if (usesPin && !/^\d+$/.test(newPin)) {
      setPinError(t("settings.pinDigitsOnly"));
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(credentialCopy.mismatch);
      return;
    }

    setPinSaving(true);

    try {
      await requestWithAuth("/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPin, newPassword: newPin })
      });

      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setPinNotice(credentialCopy.updated);
      toast.success(credentialCopy.updated);
      onPasswordChanged?.();
    } catch (changeError) {
      const message = changeError instanceof Error ? changeError.message : credentialCopy.updateFailed;
      setPinError(message);
      toast.error(message);
    } finally {
      setPinSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await requestWithAuth<{ attendanceLockMinutes: number; academicYearStartMonth?: number; academicYearStartDay?: number; retentionDays?: number }>("/master-data/attendance-lock", {
        method: "GET"
      });

      const minutes = Number(result.attendanceLockMinutes ?? 60);
      setLockMinutes(minutes);
      setSavedMinutes(minutes);
      setAcademicYearStartMonth(Number(result.academicYearStartMonth ?? 4));
      setAcademicYearStartDay(Number(result.academicYearStartDay ?? 1));
      setRetentionDays(Number(result.retentionDays ?? 2));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("settings.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [requestWithAuth, t]);

  useEffect(() => {
    if (forcePasswordChange) {
      setLoading(false);
      return;
    }
    void load();
  }, [forcePasswordChange, load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await requestWithAuth("/master-data/attendance-lock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attendanceLockMinutes: lockMinutes,
          academicYearStartMonth,
          academicYearStartDay,
          retentionDays
        })
      });

      setSavedMinutes(lockMinutes);
      setNotice(t("settings.policyUpdated"));
      toast.success(t("settings.policyUpdated"));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t("settings.saveFailed");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewArchive = async () => {
    if (!archiveYear.trim()) {
      setError(t("settings.archiveYearLabel"));
      return;
    }

    setArchivePreviewing(true);
    setError(null);
    try {
      const response = await requestWithAuth<{ studentCount: number; attendanceCount: number }>(`/master-data/attendance-archive/preview?academicYear=${encodeURIComponent(archiveYear.trim())}`, {
        method: "GET"
      });
      setArchivePreview(response);
      toast.success(t("settings.archivePreviewSuccess"));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t("settings.archivePreviewFailed");
      setError(message);
      toast.error(message);
    } finally {
      setArchivePreviewing(false);
    }
  };

  const handleFinalizeArchive = async () => {
    if (!archiveYear.trim()) {
      setError(t("settings.archiveYearLabel"));
      return;
    }

    setArchiveFinalizing(true);
    setError(null);
    try {
      await requestWithAuth("/master-data/attendance-archive/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academicYear: archiveYear.trim() })
      });
      setArchivePreview(null);
      toast.success(t("settings.archiveFinalizeSuccess"));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t("settings.archiveFinalizeFailed");
      setError(message);
      toast.error(message);
    } finally {
      setArchiveFinalizing(false);
    }
  };

  const handleToastsToggle = (checked: boolean) => {
    setToastsEnabled(checked);
    localStorage.setItem(TOASTS_ENABLED_KEY, String(checked));
    if (checked) {
      toast.success(t("settings.toastsEnabled"));
    }
  };

  const handleDefaultReportDaysChange = (days: number) => {
    setDefaultReportDays(days);
    localStorage.setItem(DEFAULT_REPORT_DAYS_KEY, String(days));
    toast.success(t("settings.dateRangeUpdated"));
  };

  return (
    <div className="page-content fade-in">
      <div className="page-title-wrap">
        <h2>{t("settings.title", { defaultValue: "Settings" })}</h2>
        <span className="active-crumb">{t("settings.crumb")}</span>
      </div>

      <div className="settings-grid">
        <section className="table-panel">
          <div className="table-header">
            <div>
              <h2 className="panel-title">
                <KeyRound size={16} /> {credentialCopy.title}
              </h2>
              <p className="panel-subtitle">{credentialCopy.description}</p>
            </div>
          </div>
          <div className="settings-body">
            {forcePasswordChange ? <p className="locked-note">{t("settings.passwordChangeRequired")}</p> : null}
            <form className="settings-form" onSubmit={changePin}>
              <div className="form-field">
                <label htmlFor="current-pin">{credentialCopy.current}</label>
                <PasswordInput
                  id="current-pin"
                  autoComplete="current-password"
                  inputMode={usesPin ? "numeric" : "text"}
                  value={currentPin}
                  maxLength={64}
                  required
                  onChange={(event) => setCurrentPin(usesPin ? event.target.value.replace(/\D/g, "") : event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="new-pin">{credentialCopy.next}</label>
                <PasswordInput
                  id="new-pin"
                  autoComplete="new-password"
                  inputMode={usesPin ? "numeric" : "text"}
                  value={newPin}
                  minLength={4}
                  maxLength={64}
                  required
                  onChange={(event) => setNewPin(usesPin ? event.target.value.replace(/\D/g, "") : event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="confirm-pin">{credentialCopy.confirm}</label>
                <PasswordInput
                  id="confirm-pin"
                  autoComplete="new-password"
                  inputMode={usesPin ? "numeric" : "text"}
                  value={confirmPin}
                  minLength={4}
                  maxLength={64}
                  required
                  onChange={(event) => setConfirmPin(usesPin ? event.target.value.replace(/\D/g, "") : event.target.value)}
                />
              </div>

              {pinError ? <p className="error-text">{pinError}</p> : null}
              {pinNotice ? <p className="success-text">{pinNotice}</p> : null}

              <button type="submit" className="primary-btn" disabled={pinSaving}>
                {pinSaving ? t("settings.updating") : credentialCopy.update}
              </button>
            </form>
            {usesPin ? <p className="policy-hint">{t("settings.forgotPin")}</p> : null}
          </div>
        </section>

        <section className={canEdit ? "table-panel" : "table-panel is-locked"}>
          <div className="table-header">
            <div>
              <h2 className="panel-title">
                <Lock size={16} /> {t("settings.editWindowTitle")}
              </h2>
              <p className="panel-subtitle">
                {t("settings.editWindowDesc")}
              </p>
            </div>
            {canEdit ? null : (
              <span className="locked-badge">
                <Lock size={12} /> {t("settings.locked")}
              </span>
            )}
          </div>

          {loading ? (
            <PageLoader label={t("settings.loadingSettings")} />
          ) : (
            <div className="settings-body">
              <div className="form-field">
                <label htmlFor="lock-minutes">{t("settings.lockAfter")}</label>
                <select
                  id="lock-minutes"
                  value={lockMinutes}
                  disabled={!canEdit}
                  onChange={(event) => setLockMinutes(Number(event.target.value))}
                >
                  {lockOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <p className="policy-hint">
                <Clock size={14} /> {describeLock(lockMinutes, t)}
              </p>

              {error ? <p className="error-text">{error}</p> : null}
              {notice ? <p className="success-text">{notice}</p> : null}

              {canEdit ? (
                <button
                  type="button"
                  className="primary-btn"
                  disabled={saving || lockMinutes === savedMinutes}
                  onClick={() => void save()}
                >
                  {saving ? t("settings.saving") : t("settings.savePolicy")}
                </button>
              ) : (
                <p className="locked-note">
                  <Lock size={14} />
                  <span>{t("settings.adminOnly")}</span>
                </p>
              )}
            </div>
          )}
        </section>

        <section className="table-panel">
          <div className="table-header">
            <div>
              <h2 className="panel-title">
                <Archive size={16} /> {t("settings.archiveTitle")}
              </h2>
              <p className="panel-subtitle">{t("settings.archiveDesc")}</p>
            </div>
          </div>
          <div className="settings-body">
            <div className="form-field">
              <label htmlFor="archive-year">{t("settings.archiveYearLabel")}</label>
              <input
                id="archive-year"
                value={archiveYear}
                placeholder={t("settings.archiveYearPlaceholder")}
                onChange={(event) => setArchiveYear(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="academic-year-start-month">{t("settings.archiveStartMonthLabel")}</label>
              <select
                id="academic-year-start-month"
                value={academicYearStartMonth}
                onChange={(event) => setAcademicYearStartMonth(Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="academic-year-start-day">{t("settings.archiveStartDayLabel")}</label>
              <input
                id="academic-year-start-day"
                type="number"
                min="1"
                max="31"
                value={academicYearStartDay}
                onChange={(event) => setAcademicYearStartDay(Number(event.target.value))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="archive-retention-days">{t("settings.archiveRetentionLabel")}</label>
              <input
                id="archive-retention-days"
                type="number"
                min="1"
                max="3650"
                value={retentionDays}
                onChange={(event) => setRetentionDays(Number(event.target.value))}
              />
            </div>
            {archivePreview ? (
              <div className="policy-hint">
                <strong>{t("settings.archivePreviewSummary", { studentCount: archivePreview.studentCount, attendanceCount: archivePreview.attendanceCount })}</strong>
              </div>
            ) : null}
            <div className="settings-actions">
              <button type="button" className="secondary-btn" disabled={archivePreviewing} onClick={() => void handlePreviewArchive()}>
                {archivePreviewing ? t("settings.archivePreviewing") : t("settings.archivePreview")}
              </button>
              <button type="button" className="primary-btn" disabled={archiveFinalizing} onClick={() => void handleFinalizeArchive()}>
                {archiveFinalizing ? t("settings.archiveFinalizing") : t("settings.archiveFinalize")}
              </button>
            </div>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-header">
            <div>
              <h2 className="panel-title">
                <ShieldCheck size={16} /> {t("settings.adminOverrideTitle")}
              </h2>
              <p className="panel-subtitle">{t("settings.adminOverrideDesc")}</p>
            </div>
          </div>
          <div className="settings-body">
            <ul className="policy-list">
              <li>
                <strong>{t("settings.teachersLabel")}</strong> {t("settings.teachersRule")}
              </li>
              <li>
                <strong>{t("settings.adminsLabel")}</strong> {t("settings.adminsRule")}
              </li>
            </ul>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-header">
            <div>
              <h2 className="panel-title">
                <BellRing size={16} /> {t("settings.notificationsTitle")}
              </h2>
              <p className="panel-subtitle">{t("settings.notificationsDesc")}</p>
            </div>
          </div>
          <div className="settings-body">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={toastsEnabled}
                onChange={(event) => handleToastsToggle(event.target.checked)}
              />
              {t("settings.showToasts")}
            </label>
            <p className="policy-hint">
              {t("settings.toastsHint")}
            </p>
          </div>
        </section>

        <section className="table-panel">
          <div className="table-header">
            <div>
              <h2 className="panel-title">
                <LayoutDashboard size={16} /> {t("settings.dashboardDefaultsTitle")}
              </h2>
              <p className="panel-subtitle">{t("settings.dashboardDefaultsDesc")}</p>
            </div>
          </div>
          <div className="settings-body">
            <div className="form-field">
              <label htmlFor="default-report-days">{t("settings.defaultDateRange")}</label>
              <select
                id="default-report-days"
                value={defaultReportDays}
                onChange={(event) => handleDefaultReportDaysChange(Number(event.target.value))}
              >
                {reportDaysOptions.map((days) => (
                  <option key={days} value={days}>
                    {t("settings.lastDays", { days })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default SettingsPage;

