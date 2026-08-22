import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useToast } from "../lib/toast";
import { InlineLoader } from "../components/Loader";
import { PasswordInput } from "../components/PasswordInput";
import {
  BookOpen,
  GraduationCap,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCog,
  X
} from "lucide-react";

export type ManageRequest = <T>(path: string, options: RequestInit) => Promise<T>;

type EntityKey = "students" | "teachers" | "classes";

type RefSource = "classes";

type FieldKind = "text" | "email" | "tel" | "date" | "select" | "ref" | "multiref" | "tags" | "toggle";

type FieldConfig = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: { value: string; label: string }[];
  refSource?: RefSource;
  placeholder?: string;
  defaultValue?: unknown;
};

type ColumnConfig = {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>, lookups: Lookups) => React.ReactNode;
};

type EntityConfig = {
  key: EntityKey;
  path: string;
  label: string;
  singular: string;
  icon: React.ComponentType<{ size?: number }>;
  searchPlaceholder: string;
  columns: ColumnConfig[];
  fields: FieldConfig[];
};

type SortKey = "name" | "class" | "rollNumber" | "regNo";
type SortDirection = "asc" | "desc";

type ListResponse = {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type RefItem = { _id: string; label: string };

type Lookups = Record<RefSource, RefItem[]>;

const PAGE_SIZE = 12;

const emptyLookups: Lookups = { classes: [] };

function idOf(row: Record<string, unknown>): string {
  return String(row._id ?? row.id ?? "");
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function lookupLabel(lookups: Lookups, source: RefSource, value: unknown): string {
  const id = textOf(value);
  if (!id) {
    return "—";
  }

  return lookups[source].find((item) => item._id === id)?.label ?? "—";
}

function searchableValues(row: Record<string, unknown>, entity: EntityKey, lookups: Lookups): string[] {
  const className = lookupLabel(lookups, "classes", row.classId);
  if (entity === "students") {
    return [
      row.regNo,
      row.fullName,
      row.rollNumber,
      row.fatherName,
      row.motherName,
      row.phoneNumber,
      className
    ].map(textOf);
  }
  if (entity === "teachers") {
    return [row.fullName, row.phoneNumber, className].map(textOf);
  }
  return [row.name].map(textOf);
}

function sortValue(row: Record<string, unknown>, key: SortKey, lookups: Lookups): string {
  if (key === "class") {
    return lookupLabel(lookups, "classes", row.classId);
  }
  if (key === "name") {
    return textOf(row.fullName ?? row.name);
  }
  return textOf(row[key]);
}

function boolBadge(value: unknown, trueLabel: string, falseLabel: string) {
  const active = value === undefined ? true : Boolean(value);
  return <span className={`status-badge ${active ? "present" : "absent"}`}>{active ? trueLabel : falseLabel}</span>;
}

function buildEntityConfigs(t: TFunction): EntityConfig[] {
  return [
  {
    key: "students",
    path: "/master-data/students",
    label: t("manage.students"),
    singular: t("manage.studentSingular"),
    icon: GraduationCap,
    searchPlaceholder: t("manage.searchStudents"),
    columns: [
      { key: "regNo", label: t("manage.colRegNo") },
      { key: "fullName", label: t("manage.colFullName") },
      { key: "classId", label: t("manage.colClass"), render: (row, l) => lookupLabel(l, "classes", row.classId) },
      { key: "rollNumber", label: t("manage.colRollNo") },
      { key: "fatherName", label: t("manage.colFatherName") },
      { key: "phoneNumber", label: t("manage.colPhone"), render: (row) => textOf(row.phoneNumber) || <span className="muted">{t("manage.notSet")}</span> },
      {
        key: "status",
        label: t("manage.colStatus"),
        render: (row) => boolBadge(row.status !== "inactive", t("manage.active"), t("manage.inactive"))
      }
    ],
    fields: [
      { name: "regNo", label: t("manage.fieldRegNo"), kind: "text", required: true },
      { name: "fullName", label: t("manage.fieldFullName"), kind: "text", required: true },
      { name: "classId", label: t("manage.fieldClass"), kind: "ref", refSource: "classes", required: true },
      { name: "rollNumber", label: t("manage.fieldRollNumber"), kind: "text" },
      { name: "dob", label: t("manage.fieldDob"), kind: "date" },
      { name: "fatherName", label: t("manage.fieldFatherName"), kind: "text" },
      { name: "motherName", label: t("manage.fieldMotherName"), kind: "text" },
      { name: "phoneNumber", label: t("manage.fieldPhoneNumber"), kind: "tel", placeholder: t("manage.phonePlaceholder") },
      {
        name: "status",
        label: t("manage.fieldStatus"),
        kind: "select",
        defaultValue: "active",
        options: [
          { value: "active", label: t("manage.active") },
          { value: "inactive", label: t("manage.inactive") }
        ]
      }
    ]
  },
  {
    key: "teachers",
    path: "/master-data/teachers",
    label: t("manage.teachers"),
    singular: t("manage.teacherSingular"),
    icon: UserCog,
    searchPlaceholder: t("manage.searchTeachers"),
    columns: [
      { key: "fullName", label: t("manage.colFullName") },
      { key: "classId", label: t("manage.colClass"), render: (row, l) => lookupLabel(l, "classes", row.classId) },
      { key: "phoneNumber", label: t("manage.colPhone") },
      { key: "isActive", label: t("manage.colStatus"), render: (row) => boolBadge(row.isActive, t("manage.active"), t("manage.inactive")) }
    ],
    fields: [
      { name: "fullName", label: t("manage.fieldFullName"), kind: "text", required: true },
      { name: "classId", label: t("manage.fieldClass"), kind: "ref", refSource: "classes" },
      { name: "phoneNumber", label: t("manage.fieldPhoneNumber"), kind: "tel" },
      { name: "isActive", label: t("manage.fieldActive"), kind: "toggle", defaultValue: true }
    ]
  },
  {
    key: "classes",
    path: "/master-data/classes",
    label: t("manage.classes"),
    singular: t("manage.classSingular"),
    icon: BookOpen,
    searchPlaceholder: t("manage.searchClasses"),
    columns: [
      { key: "name", label: t("manage.colClassName") },
      { key: "isActive", label: t("manage.colStatus"), render: (row) => boolBadge(row.isActive, t("manage.active"), t("manage.inactive")) }
    ],
    fields: [
      { name: "name", label: t("manage.fieldClassName"), kind: "text", required: true, placeholder: t("manage.classNamePlaceholder") },
      { name: "isActive", label: t("manage.fieldActive"), kind: "toggle", defaultValue: true }
    ]
  }
  ];
}

function buildInitialForm(config: EntityConfig, row?: Record<string, unknown>): Record<string, unknown> {
  const form: Record<string, unknown> = {};

  for (const field of config.fields) {
    const existing = row?.[field.name];

    if (field.kind === "multiref") {
      form[field.name] = Array.isArray(existing) ? (existing as unknown[]).map(textOf) : [];
    } else if (field.kind === "tags") {
      form[field.name] = Array.isArray(existing) ? (existing as unknown[]).map(textOf).join(", ") : "";
    } else if (field.kind === "toggle") {
      form[field.name] = existing === undefined ? Boolean(field.defaultValue) : Boolean(existing);
    } else if (field.kind === "date") {
      // <input type="date"> only accepts YYYY-MM-DD, the API returns full ISO timestamps.
      form[field.name] = existing ? textOf(existing).slice(0, 10) : "";
    } else {
      form[field.name] = existing === undefined || existing === null ? (field.defaultValue ?? "") : textOf(existing);
    }
  }

  return form;
}

function buildPayload(config: EntityConfig, form: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of config.fields) {
    const value = form[field.name];

    if (field.kind === "toggle") {
      payload[field.name] = Boolean(value);
      continue;
    }

    if (field.kind === "multiref") {
      payload[field.name] = Array.isArray(value) ? value : [];
      continue;
    }

    if (field.kind === "tags") {
      payload[field.name] = textOf(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      continue;
    }

    const trimmed = textOf(value).trim();
    if (!trimmed && !field.required) {
      if (field.kind === "ref") {
        payload[field.name] = null;
      }
      continue;
    }

    payload[field.name] = trimmed;
  }

  return payload;
}

export function ManagePage({ requestWithAuth, canEdit }: { requestWithAuth: ManageRequest; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [activeKey, setActiveKey] = useState<EntityKey>("students");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookups, setLookups] = useState<Lookups>(emptyLookups);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [resetPinFor, setResetPinFor] = useState<{ id: string; name: string } | null>(null);
  const [newPin, setNewPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaving, setPinSaving] = useState(false);

  const configs = useMemo(() => buildEntityConfigs(t), [t]);
  const config = useMemo(
    () => configs.find((item) => item.key === activeKey) ?? configs[0],
    [configs, activeKey]
  );
  const sortOptions = useMemo(() => {
    if (activeKey === "students") {
      return [
        { value: "name", label: t("manage.sortName") },
        { value: "class", label: t("manage.sortClass") },
        { value: "rollNumber", label: t("manage.sortRollNumber") },
        { value: "regNo", label: t("manage.sortRegNo") }
      ];
    }
    if (activeKey === "teachers") {
      return [
        { value: "name", label: t("manage.sortName") },
        { value: "class", label: t("manage.sortClass") }
      ];
    }
    return [{ value: "name", label: t("manage.sortName") }];
  }, [activeKey, t]);

  const loadLookups = useCallback(async () => {
    try {
      const classes = await requestWithAuth<{ items: Record<string, unknown>[] }>("/master-data/classes", { method: "GET" });

      setLookups({
        classes: classes.items.map((item) => ({
          _id: idOf(item),
          label: textOf(item.name)
        }))
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("manage.errLoadRef"));
    }
  }, [requestWithAuth, t]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await requestWithAuth<ListResponse>(config.path, { method: "GET" });
      setRows(result.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("manage.errLoadRecords"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [config.path, requestWithAuth, t]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.toLocaleLowerCase();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const result = rows.filter((row) => {
      if (classFilter && textOf(row.classId) !== classFilter) {
        return false;
      }
      return !normalizedSearch || searchableValues(row, activeKey, lookups)
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    });

    return result.sort((left, right) => {
      const comparison = collator.compare(sortValue(left, sortKey, lookups), sortValue(right, sortKey, lookups));
      if (comparison !== 0) {
        return sortDirection === "asc" ? comparison : -comparison;
      }
      return collator.compare(textOf(left.fullName ?? left.name), textOf(right.fullName ?? right.name));
    });
  }, [activeKey, classFilter, lookups, rows, search, sortDirection, sortKey]);

  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page]
  );

  useEffect(() => {
    setTotal(filteredRows.length);
    const nextTotalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    setTotalPages(nextTotalPages);
    setPage((current) => Math.min(current, nextTotalPages));
  }, [filteredRows]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const switchTab = (key: EntityKey) => {
    setActiveKey(key);
    setPage(1);
    setSearchInput("");
    setSearch("");
    setClassFilter("");
    setSortKey("name");
    setSortDirection("asc");
    setNotice(null);
    setError(null);
    setPendingDeleteId(null);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(buildInitialForm(config));
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditingId(idOf(row));
    setForm(buildInitialForm(config, row));
    setFormError(null);
    setEditorOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const payload = buildPayload(config, form);
      const isEdit = Boolean(editingId);

      const response = await requestWithAuth<{ credentials?: { username: string; temporaryPin: string } }>(
        isEdit ? `${config.path}/${editingId}` : config.path,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      setEditorOpen(false);
      // A newly created teacher gets a one-time login; surface it so the admin can share it.
      if (!isEdit && response?.credentials) {
        const credentialNotice = t("manage.loginCreated", {
          username: response.credentials.username,
          pin: response.credentials.temporaryPin
        });
        setNotice(credentialNotice);
        toast.success(credentialNotice);
      } else {
        setNotice(isEdit ? t("manage.recordUpdated") : t("manage.recordCreated"));
        toast.success(isEdit ? t("manage.recordUpdated") : t("manage.recordCreated"));
      }
      await Promise.all([loadRows(), loadLookups()]);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : t("manage.errSaveRecord");
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setNotice(null);

    try {
      await requestWithAuth(`${config.path}/${id}`, { method: "DELETE" });
      setPendingDeleteId(null);
      setNotice(t("manage.recordDeleted"));
      toast.success(t("manage.recordDeleted"));
      await Promise.all([loadRows(), loadLookups()]);
    } catch (deleteError) {
      setPendingDeleteId(null);
      const message = deleteError instanceof Error ? deleteError.message : t("manage.errDeleteRecord");
      setError(message);
      toast.error(message);
    }
  };

  const refOptions = (field: FieldConfig): RefItem[] => {
    if (!field.refSource) {
      return [];
    }

    return lookups[field.refSource];
  };

  const setField = (name: string, value: unknown) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const toggleMultiRef = (name: string, id: string) => {
    setForm((current) => {
      const selected = Array.isArray(current[name]) ? [...(current[name] as string[])] : [];
      const index = selected.indexOf(id);
      if (index >= 0) {
        selected.splice(index, 1);
      } else {
        selected.push(id);
      }

      return { ...current, [name]: selected };
    });
  };

  const handleResetPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetPinFor) {
      return;
    }

    const normalizedPin = newPin.trim();
    if (normalizedPin.length < 4) {
      setPinError(t("manage.errPinLength"));
      return;
    }
    if (!/^\d+$/.test(normalizedPin)) {
      setPinError(t("manage.errPinDigits"));
      return;
    }

    setPinSaving(true);
    setPinError(null);

    try {
      const result = await requestWithAuth<{ username: string }>(
        `/master-data/teachers/${resetPinFor.id}/reset-pin`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPin: normalizedPin })
        }
      );

      toast.success(t("manage.pinResetToast", { name: resetPinFor.name, username: result.username }));
      setResetPinFor(null);
      setNewPin("");
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : t("manage.errResetPin");
      setPinError(message);
      toast.error(message);
    } finally {
      setPinSaving(false);
    }
  };

  return (
    <div className="page-content fade-in">
      <div className="page-title-wrap">
        <h2>{t("manage.title", { defaultValue: "Master Data" })}</h2>
        <span className="active-crumb">{config.label}</span>
      </div>

      <div className="manage-tabs master-data-tabs">
        {configs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              className={`tab-btn${item.key === activeKey ? " active" : ""}`}
              onClick={() => switchTab(item.key)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="table-panel">
        <div className="table-header">
          <div>
            <h2 className="panel-title">{config.label}</h2>
            <p className="panel-subtitle">
              {total} {total === 1 ? t("manage.recordSingular") : t("manage.recordPlural")}
            </p>
          </div>
          <div className="table-controls">
            <div className="search-inline">
              <Search size={15} />
              <input
                type="search"
                value={searchInput}
                placeholder={config.searchPlaceholder}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            {activeKey !== "classes" ? (
              <label className="master-data-control">
                <span>{t("manage.filterClass")}</span>
                <select
                  value={classFilter}
                  onChange={(event) => { setClassFilter(event.target.value); setPage(1); }}
                >
                  <option value="">{t("manage.allClasses")}</option>
                  {lookups.classes.map((item) => (
                    <option key={item._id} value={item._id}>{item.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="master-data-control">
              <span>{t("manage.sortBy")}</span>
              <select
                value={sortKey}
                onChange={(event) => { setSortKey(event.target.value as SortKey); setPage(1); }}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="master-data-control">
              <span>{t("manage.sortDirection")}</span>
              <select
                value={sortDirection}
                onChange={(event) => { setSortDirection(event.target.value as SortDirection); setPage(1); }}
              >
                <option value="asc">{t("manage.ascending")}</option>
                <option value="desc">{t("manage.descending")}</option>
              </select>
            </label>
            {canEdit ? (
              <button type="button" className="primary-btn" onClick={openCreate}>
                <Plus size={16} />
                <span>{t("manage.addEntity", { entity: config.singular })}</span>
              </button>
            ) : null}
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {notice ? <p className="success-text">{notice}</p> : null}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {config.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                {canEdit ? <th style={{ textAlign: "right" }}>{t("manage.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={config.columns.length + 1}>
                    <InlineLoader label={t("manage.loading")} />
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={config.columns.length + 1}>
                    <div className="empty-state">
                      {search
                        ? t("manage.emptyStateSearch", { entity: config.label.toLowerCase(), search })
                        : classFilter
                          ? t("manage.emptyStateFiltered", { entity: config.label.toLowerCase() })
                          : t("manage.emptyState", { entity: config.label.toLowerCase() })}
                    </div>
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const rowId = idOf(row);
                  return (
                    <tr key={rowId}>
                      {config.columns.map((column) => (
                        <td key={column.key}>
                          {column.render ? column.render(row, lookups) : textOf(row[column.key]) || "—"}
                        </td>
                      ))}
                      {canEdit ? (
                        <td>
                          <div className="row-actions">
                            {pendingDeleteId === rowId ? (
                              <>
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  onClick={() => void handleDelete(rowId)}
                                >
                                  {t("manage.confirm")}
                                </button>
                                <button type="button" className="icon-btn" onClick={() => setPendingDeleteId(null)}>
                                  {t("common.cancel")}
                                </button>
                              </>
                            ) : (
                              <>
                                {config.key === "teachers" ? (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label={t("manage.resetPin")}
                                    title={t("manage.resetPin")}
                                    onClick={() => {
                                      setResetPinFor({ id: rowId, name: textOf(row.fullName) });
                                      setNewPin("");
                                      setPinError(null);
                                    }}
                                  >
                                    <KeyRound size={15} />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label={t("manage.edit")}
                                  onClick={() => openEdit(row)}
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  aria-label={t("manage.delete")}
                                  onClick={() => setPendingDeleteId(rowId)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("common.previous")}
          </button>
          <span>
            {t("manage.pageOf", { page, totalPages })}
          </span>
          <button
            type="button"
            className="ghost-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
          </button>
        </div>
      </div>

      {editorOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditorOpen(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                {editingId
                  ? t("manage.editEntity", { entity: config.singular })
                  : t("manage.newEntity", { entity: config.singular })}
              </h2>
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setEditorOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                {config.fields.map((field) => {
                  const value = form[field.name];

                  if (field.kind === "toggle") {
                    return (
                      <label className="checkbox-row" key={field.name}>
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) => setField(field.name, event.target.checked)}
                        />
                        <span>{field.label}</span>
                      </label>
                    );
                  }

                  if (field.kind === "multiref") {
                    const selected = Array.isArray(value) ? (value as string[]) : [];
                    const options = refOptions(field);

                    return (
                      <div className="form-field span-2" key={field.name}>
                        <label>{field.label}</label>
                        <div className="multiselect-box">
                          {options.length === 0 ? (
                            <span className="muted">{t("manage.noOptions")}</span>
                          ) : (
                            options.map((option) => (
                              <button
                                type="button"
                                key={option._id}
                                className={`chip selectable${selected.includes(option._id) ? " selected" : ""}`}
                                onClick={() => toggleMultiRef(field.name, option._id)}
                              >
                                {option.label}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (field.kind === "ref" || field.kind === "select") {
                    const options =
                      field.kind === "ref"
                        ? refOptions(field).map((option) => ({ value: option._id, label: option.label }))
                        : (field.options ?? []);

                    return (
                      <div className="form-field" key={field.name}>
                        <label htmlFor={`field-${field.name}`}>
                          {field.label}
                          {field.required ? <span className="req">*</span> : null}
                        </label>
                        <select
                          id={`field-${field.name}`}
                          value={textOf(value)}
                          required={field.required}
                          onChange={(event) => setField(field.name, event.target.value)}
                        >
                          <option value="">{t("manage.selectField", { field: field.label.toLowerCase() })}</option>
                          {options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  return (
                    <div className="form-field" key={field.name}>
                      <label htmlFor={`field-${field.name}`}>
                        {field.label}
                        {field.required ? <span className="req">*</span> : null}
                      </label>
                      <input
                        id={`field-${field.name}`}
                        type={field.kind === "tags" ? "text" : field.kind}
                        value={textOf(value)}
                        required={field.required}
                        placeholder={field.placeholder}
                        onChange={(event) => setField(field.name, event.target.value)}
                      />
                    </div>
                  );
                })}
              </div>

              {formError ? <p className="error-text">{formError}</p> : null}

              <div className="modal-footer">
                <button type="button" className="ghost-btn" onClick={() => setEditorOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? t("manage.saving") : editingId ? t("manage.saveChanges") : t("manage.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {resetPinFor ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setResetPinFor(null)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{t("manage.resetPin")}</h2>
              <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={() => setResetPinFor(null)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleResetPin}>
              <div className="form-grid">
                <div className="form-field span-2">
                  <label htmlFor="reset-pin-input">
                    {t("manage.newPinFor", { name: resetPinFor.name })}
                    <span className="req">*</span>
                  </label>
                  <PasswordInput
                    id="reset-pin-input"
                    inputMode="numeric"
                    autoComplete="off"
                    value={newPin}
                    minLength={4}
                    maxLength={64}
                    required
                    placeholder={t("manage.pinPlaceholder")}
                    onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))}
                  />
                  <p className="panel-subtitle">
                    {t("manage.resetPinHint")}
                  </p>
                </div>
              </div>

              {pinError ? <p className="error-text">{pinError}</p> : null}

              <div className="modal-footer">
                <button type="button" className="ghost-btn" onClick={() => setResetPinFor(null)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="primary-btn" disabled={pinSaving}>
                  {pinSaving ? t("manage.resetting") : t("manage.resetPin")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ManagePage;
