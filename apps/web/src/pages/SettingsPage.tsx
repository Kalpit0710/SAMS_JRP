import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { BellRing, Clock, KeyRound, LayoutDashboard, Lock, ShieldCheck } from "lucide-react";
import { PageLoader } from "../components/Loader";
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
  forcePasswordChange = false,
  onPasswordChanged
}: {
  requestWithAuth: SettingsRequest;
  canEdit: boolean;
  forcePasswordChange?: boolean;
  onPasswordChanged?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [lockMinutes, setLockMinutes] = useState(60);
  const [savedMinutes, setSavedMinutes] = useState(60);
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
      setPinError(t("settings.pinTooShort"));
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(t("settings.pinMismatch"));
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
      setPinNotice(t("settings.pinUpdated"));
      toast.success(t("settings.pinUpdated"));
      onPasswordChanged?.();
    } catch (changeError) {
      const message = changeError instanceof Error ? changeError.message : t("settings.pinUpdateFailed");
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
      const result = await requestWithAuth<{ attendanceLockMinutes: number }>("/master-data/attendance-lock", {
        method: "GET"
      });

      const minutes = Number(result.attendanceLockMinutes ?? 60);
      setLockMinutes(minutes);
      setSavedMinutes(minutes);
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
        body: JSON.stringify({ attendanceLockMinutes: lockMinutes })
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
                <KeyRound size={16} /> {t("settings.changePinTitle")}
              </h2>
              <p className="panel-subtitle">{t("settings.changePinDesc")}</p>
            </div>
          </div>
          <div className="settings-body">
            {forcePasswordChange ? <p className="locked-note">{t("settings.passwordChangeRequired")}</p> : null}
            <form className="settings-form" onSubmit={changePin}>
              <div className="form-field">
                <label htmlFor="current-pin">{t("settings.currentPin")}</label>
                <input
                  id="current-pin"
                  type="password"
                  autoComplete="current-password"
                  value={currentPin}
                  required
                  onChange={(event) => setCurrentPin(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="new-pin">{t("settings.newPin")}</label>
                <input
                  id="new-pin"
                  type="password"
                  autoComplete="new-password"
                  value={newPin}
                  minLength={4}
                  required
                  onChange={(event) => setNewPin(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="confirm-pin">{t("settings.confirmPin")}</label>
                <input
                  id="confirm-pin"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPin}
                  minLength={4}
                  required
                  onChange={(event) => setConfirmPin(event.target.value)}
                />
              </div>

              {pinError ? <p className="error-text">{pinError}</p> : null}
              {pinNotice ? <p className="success-text">{pinNotice}</p> : null}

              <button type="submit" className="primary-btn" disabled={pinSaving}>
                {pinSaving ? t("settings.updating") : t("settings.updatePin")}
              </button>
            </form>
            <p className="policy-hint">
              {t("settings.forgotPin")}
            </p>
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

