import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { BellRing, CalendarDays, Clock, KeyRound, LayoutDashboard, Lock, MessageCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageLoader } from "../components/Loader";
import { PasswordInput } from "../components/PasswordInput";
import { dateKeyToDisplay, displayDateToKey } from "../lib/date";
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
const weekdays = [0, 1, 2, 3, 4, 5, 6] as const;

type LeaveSettings = {
  adminWhatsAppNumber: string;
  nonWorkingWeekdays: number[];
  holidays: Array<{ date: string; name: string }>;
};

type HolidayFormRow = { id: string; date: string; name: string };

function createHolidayRow(date = "", name = ""): HolidayFormRow {
  return { id: crypto.randomUUID(), date, name };
}

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
  const [adminWhatsAppNumber, setAdminWhatsAppNumber] = useState("");
  const [nonWorkingWeekdays, setNonWorkingWeekdays] = useState<number[]>([0]);
  const [holidays, setHolidays] = useState<HolidayFormRow[]>([]);
  const [leaveSettingsLoading, setLeaveSettingsLoading] = useState(canEdit);
  const [leaveSettingsSaving, setLeaveSettingsSaving] = useState(false);
  const [leaveSettingsError, setLeaveSettingsError] = useState<string | null>(null);
  const [leaveSettingsNotice, setLeaveSettingsNotice] = useState<string | null>(null);

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

    if (!canEdit) {
      setLeaveSettingsLoading(false);
      return;
    }

    setLeaveSettingsLoading(true);
    setLeaveSettingsError(null);
    try {
      const leaveSettings = await requestWithAuth<LeaveSettings>("/leaves/settings", { method: "GET" });
      setAdminWhatsAppNumber(leaveSettings.adminWhatsAppNumber ?? "");
      setNonWorkingWeekdays(leaveSettings.nonWorkingWeekdays ?? [0]);
      setHolidays((leaveSettings.holidays ?? []).map((holiday) => createHolidayRow(
        dateKeyToDisplay(holiday.date),
        holiday.name
      )));
    } catch (loadError) {
      setLeaveSettingsError(loadError instanceof Error ? loadError.message : t("settings.leaveLoadFailed"));
    } finally {
      setLeaveSettingsLoading(false);
    }
  }, [canEdit, requestWithAuth, t]);

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

  const toggleNonWorkingWeekday = (weekday: number, checked: boolean) => {
    setNonWorkingWeekdays((current) => (
      checked
        ? [...new Set([...current, weekday])].sort((left, right) => left - right)
        : current.filter((value) => value !== weekday)
    ));
  };

  const updateHoliday = (index: number, field: keyof HolidayFormRow, value: string) => {
    setHolidays((current) => current.map((holiday, rowIndex) => (
      rowIndex === index ? { ...holiday, [field]: value } : holiday
    )));
  };

  const saveLeaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setLeaveSettingsError(null);
    setLeaveSettingsNotice(null);

    const normalizedHolidays: Array<{ date: string; name: string }> = [];
    for (const holiday of holidays) {
      const date = displayDateToKey(holiday.date);
      const name = holiday.name.trim();
      if (!date || !name) {
        setLeaveSettingsError(t("settings.leaveHolidayInvalid"));
        return;
      }
      normalizedHolidays.push({ date, name });
    }

    if (new Set(normalizedHolidays.map((holiday) => holiday.date)).size !== normalizedHolidays.length) {
      setLeaveSettingsError(t("settings.leaveHolidayDuplicate"));
      return;
    }

    setLeaveSettingsSaving(true);
    try {
      const saved = await requestWithAuth<LeaveSettings>("/leaves/settings", {
        method: "PUT",
        body: JSON.stringify({
          adminWhatsAppNumber: adminWhatsAppNumber.trim(),
          nonWorkingWeekdays,
          holidays: normalizedHolidays
        })
      });
      setAdminWhatsAppNumber(saved.adminWhatsAppNumber ?? "");
      setNonWorkingWeekdays(saved.nonWorkingWeekdays ?? []);
      setHolidays((saved.holidays ?? []).map((holiday) => createHolidayRow(dateKeyToDisplay(holiday.date), holiday.name)));
      setLeaveSettingsNotice(t("settings.leaveSettingsUpdated"));
      toast.success(t("settings.leaveSettingsUpdated"));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t("settings.leaveSaveFailed");
      setLeaveSettingsError(message);
      toast.error(message);
    } finally {
      setLeaveSettingsSaving(false);
    }
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
                <PasswordInput
                  id="current-pin"
                  autoComplete="current-password"
                  inputMode="numeric"
                  value={currentPin}
                  required
                  onChange={(event) => setCurrentPin(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="new-pin">{t("settings.newPin")}</label>
                <PasswordInput
                  id="new-pin"
                  autoComplete="new-password"
                  inputMode="numeric"
                  value={newPin}
                  minLength={4}
                  required
                  onChange={(event) => setNewPin(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="confirm-pin">{t("settings.confirmPin")}</label>
                <PasswordInput
                  id="confirm-pin"
                  autoComplete="new-password"
                  inputMode="numeric"
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

        {canEdit ? (
          <section className="table-panel settings-leave-panel">
            <div className="table-header">
              <div>
                <h2 className="panel-title">
                  <CalendarDays size={16} /> {t("settings.leaveTitle")}
                </h2>
                <p className="panel-subtitle">{t("settings.leaveDesc")}</p>
              </div>
            </div>

            {leaveSettingsLoading ? (
              <PageLoader label={t("settings.leaveLoading")} />
            ) : (
              <form className="settings-body leave-settings-form" onSubmit={saveLeaveSettings}>
                <div className="form-field">
                  <label htmlFor="admin-whatsapp-number">
                    <MessageCircle size={14} /> {t("settings.adminWhatsAppNumber")}
                  </label>
                  <input
                    id="admin-whatsapp-number"
                    type="tel"
                    inputMode="tel"
                    maxLength={30}
                    value={adminWhatsAppNumber}
                    placeholder={t("settings.adminWhatsAppPlaceholder")}
                    onChange={(event) => setAdminWhatsAppNumber(event.target.value)}
                  />
                  <p className="policy-hint">{t("settings.adminWhatsAppHint")}</p>
                </div>

                <fieldset className="leave-weekdays">
                  <legend>{t("settings.nonWorkingWeekdays")}</legend>
                  <div className="leave-weekday-options">
                    {weekdays.map((weekday) => (
                      <label className="checkbox-row" key={weekday}>
                        <input
                          type="checkbox"
                          checked={nonWorkingWeekdays.includes(weekday)}
                          onChange={(event) => toggleNonWorkingWeekday(weekday, event.target.checked)}
                        />
                        {t(`settings.weekday${weekday}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="leave-holidays">
                  <div className="leave-holidays-header">
                    <div>
                      <h3>{t("settings.schoolHolidays")}</h3>
                      <p className="policy-hint">{t("settings.schoolHolidaysHint")}</p>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setHolidays((current) => [...current, createHolidayRow()])}
                    >
                      <Plus size={16} /> {t("settings.addHoliday")}
                    </button>
                  </div>

                  {holidays.length === 0 ? <p className="locked-note">{t("settings.noHolidays")}</p> : null}
                  {holidays.map((holiday, index) => (
                    <div className="leave-holiday-row" key={holiday.id}>
                      <div className="form-field">
                        <label htmlFor={`holiday-date-${index}`}>{t("settings.holidayDate")}</label>
                        <input
                          id={`holiday-date-${index}`}
                          type="text"
                          inputMode="numeric"
                          placeholder="DD/MM/YYYY"
                          maxLength={10}
                          value={holiday.date}
                          onChange={(event) => updateHoliday(index, "date", event.target.value)}
                        />
                      </div>
                      <div className="form-field">
                        <label htmlFor={`holiday-name-${index}`}>{t("settings.holidayName")}</label>
                        <input
                          id={`holiday-name-${index}`}
                          type="text"
                          maxLength={100}
                          value={holiday.name}
                          onChange={(event) => updateHoliday(index, "name", event.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={t("settings.removeHoliday")}
                        title={t("settings.removeHoliday")}
                        onClick={() => setHolidays((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                {leaveSettingsError ? <p className="error-text">{leaveSettingsError}</p> : null}
                {leaveSettingsNotice ? <p className="success-text">{leaveSettingsNotice}</p> : null}
                <button type="submit" className="primary-btn" disabled={leaveSettingsSaving}>
                  {leaveSettingsSaving ? t("settings.saving") : t("settings.saveLeaveSettings")}
                </button>
              </form>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default SettingsPage;

