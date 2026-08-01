import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle, Download, FileSpreadsheet, Upload } from "lucide-react";
import type { ManageRequest } from "./ManagePage";

type EntityMeta = {
  key: string;
  label: string;
  columns: string[];
  required: string[];
};

type RowError = { row: number; message: string };

type PreviewResponse = {
  preview: true;
  entity: string;
  totalRows: number;
  validCount: number;
  failedCount: number;
  errors: RowError[];
};

type CommitResponse = {
  preview: false;
  entity: string;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  errors: RowError[];
};

type ImportLog = {
  _id: string;
  entity: string;
  fileName?: string;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  rolledBack: boolean;
  createdAt: string;
};

type RawRequest = (path: string, options: RequestInit) => Promise<Response>;

type DataTransferPageProps = {
  requestWithAuth: ManageRequest;
  requestWithAuthRaw: RawRequest;
  canImport: boolean;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

async function downloadCsv(requestWithAuthRaw: RawRequest, path: string, fileName: string) {
  const response = await requestWithAuthRaw(path, { method: "GET" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Download failed");
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export default function DataTransferPage({ requestWithAuth, requestWithAuthRaw, canImport }: DataTransferPageProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [entities, setEntities] = useState<EntityMeta[]>([]);
  const [activeKey, setActiveKey] = useState("students");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<ImportLog[]>([]);

  const activeEntity = entities.find((entity) => entity.key === activeKey) ?? null;

  const loadLogs = useCallback(async () => {
    try {
      const response = await requestWithAuth<{ items: ImportLog[] }>("/data-transfer/logs", { method: "GET" });
      setLogs(response.items);
    } catch {
      setLogs([]);
    }
  }, [requestWithAuth]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const response = await requestWithAuth<{ items: EntityMeta[] }>("/data-transfer/entities", { method: "GET" });
        if (!cancelled) {
          setEntities(response.items);
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(getErrorMessage(bootstrapError));
        }
      }
    };

    void bootstrap();
    void loadLogs();

    return () => {
      cancelled = true;
    };
  }, [loadLogs, requestWithAuth]);

  const resetUpload = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setResult(null);
    setSkipInvalid(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError("");
    setPreview(null);
    setResult(null);

    if (!file) {
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is larger than 2 MB. Split it into smaller batches.");
      resetUpload();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCsv(typeof reader.result === "string" ? reader.result : "");
      setFileName(file.name);
    };
    reader.onerror = () => setError("Could not read the selected file");
    reader.readAsText(file);
  };

  const runImport = async (commit: boolean) => {
    if (!csv) {
      setError("Choose a CSV file first");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await requestWithAuth<PreviewResponse | CommitResponse>(`/data-transfer/import/${activeKey}`, {
        method: "POST",
        body: JSON.stringify({ csv, fileName, commit, skipInvalid })
      });

      if (response.preview) {
        setPreview(response);
        setResult(null);
      } else {
        setResult(response);
        setPreview(null);
        setCsv("");
        setFileName("");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        await loadLogs();
      }
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (kind: "template" | "export") => {
    setError("");
    try {
      await downloadCsv(
        requestWithAuthRaw,
        `/data-transfer/${kind}/${activeKey}`,
        `${activeKey}-${kind === "template" ? "template" : "export"}.csv`
      );
    } catch (downloadError) {
      setError(getErrorMessage(downloadError));
    }
  };

  const errors = preview?.errors ?? result?.errors ?? [];

  return (
    <div className="page-content fade-in data-transfer-page">
      <div className="transfer-page-heading">
        <h2>{t("dataTransfer.title")}</h2>
        <p>{t("dataTransfer.subtitle")}</p>
      </div>

      <section className="transfer-workbench">
        <div className="transfer-entity-tabs" role="tablist" aria-label={t("dataTransfer.entityType")}>
          {entities.map((entity) => (
            <button
              key={entity.key}
              type="button"
              role="tab"
              aria-selected={activeKey === entity.key}
              className={activeKey === entity.key ? "active" : ""}
              onClick={() => {
                setActiveKey(entity.key);
                resetUpload();
                setError("");
              }}
            >
              {t(`dataTransfer.entities.${entity.key}`, { defaultValue: entity.label })}
            </button>
          ))}
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="transfer-panes">
          <section className="transfer-pane transfer-download-pane">
            <div className="transfer-pane-heading">
              <span className="transfer-pane-icon"><Download size={18} /></span>
              <div>
                <h3>{t("dataTransfer.downloadTitle")}</h3>
                <p>{t("dataTransfer.downloadDesc")}</p>
              </div>
            </div>
            {activeEntity ? (
              <div className="transfer-schema">
                <p>{t("dataTransfer.columns", { columns: activeEntity.columns.join(", ") })}</p>
                <p><strong>{t("dataTransfer.required", { required: activeEntity.required.join(", ") })}</strong></p>
              </div>
            ) : null}
            <div className="transfer-actions">
              <button type="button" className="ghost-btn" onClick={() => void handleDownload("template")}>
                <FileSpreadsheet size={15} /> {t("dataTransfer.template")}
              </button>
              <button type="button" className="primary-btn" onClick={() => void handleDownload("export")}>
                <Download size={15} /> {t("dataTransfer.exportData")}
              </button>
            </div>
          </section>

          <section className="transfer-pane transfer-upload-pane">
            <div className="transfer-pane-heading">
              <span className="transfer-pane-icon"><Upload size={18} /></span>
              <div>
                <h3>{t("dataTransfer.uploadTitle")}</h3>
                <p>{t("dataTransfer.uploadDesc")}</p>
              </div>
            </div>
            {canImport ? (
              <>
                <input
                  ref={fileInputRef}
                  className="transfer-file-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  hidden
                />
                <button
                  type="button"
                  className={`transfer-file-picker${fileName ? " has-file" : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileSpreadsheet size={22} />
                  <span>
                    <strong>{fileName || t("dataTransfer.chooseCsv")}</strong>
                    <small>{fileName ? t("dataTransfer.replaceFile") : t("dataTransfer.fileHint")}</small>
                  </span>
                </button>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={skipInvalid}
                    onChange={(event) => setSkipInvalid(event.target.checked)}
                  />
                  <span>{t("dataTransfer.skipInvalid")}</span>
                </label>
                <div className="transfer-actions">
                  <button type="button" className="ghost-btn" disabled={!csv || busy} onClick={() => void runImport(false)}>
                    {t("dataTransfer.validate")}
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={!preview || busy || (preview.validCount === 0)}
                    onClick={() => void runImport(true)}
                  >
                    <Upload size={15} /> {t("dataTransfer.importRows", { rows: preview ? t("dataTransfer.importRowCount", { count: preview.validCount }) : "" })}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">{t("dataTransfer.importOnlyAdmins")}</p>
            )}
          </section>
        </div>

        {preview ? (
          <div className="transfer-result">
            <p>
              <strong>{preview.totalRows}</strong> {t("dataTransfer.rowsRead")} &middot; <span className="success-text">{t("dataTransfer.ready", { count: preview.validCount })}</span>{" "}              &middot; <span className="error-text">{t("dataTransfer.withProblems", { count: preview.failedCount })}</span>
            </p>
          </div>
        ) : null}

        {result ? (
          <div className="transfer-result">
            <p className="success-text">
              <CheckCircle size={15} /> {t("dataTransfer.imported", { created: result.createdCount, total: result.totalRows })}
              {result.failedCount > 0 ? ` ${t("dataTransfer.skippedCount", { count: result.failedCount })}` : ""}
            </p>
          </div>
        ) : null}

        {errors.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>{t("dataTransfer.colRow")}</th>
                  <th>{t("dataTransfer.colProblem")}</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((rowError) => (
                  <tr key={`${rowError.row}-${rowError.message}`}>
                    <td>{rowError.row}</td>
                    <td>
                      <span className="error-text">
                        <AlertCircle size={13} /> {rowError.message}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="table-panel">
        <div className="table-header">
          <div>
            <h2 className="panel-title">{t("dataTransfer.recentImports")}</h2>
            <p className="panel-subtitle">{t("dataTransfer.recentImportsDesc")}</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("dataTransfer.colWhen")}</th>
                <th>{t("dataTransfer.colEntity")}</th>
                <th>{t("dataTransfer.colFile")}</th>
                <th>{t("dataTransfer.colRows")}</th>
                <th>{t("dataTransfer.colCreated")}</th>
                <th>{t("dataTransfer.colFailed")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <FileSpreadsheet size={28} />
                      <p>{t("dataTransfer.noImports")}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.entity}</td>
                    <td>{log.fileName || <span className="muted">-</span>}</td>
                    <td>{log.totalRows}</td>
                    <td>{log.createdCount}</td>
                    <td>{log.rolledBack ? <span className="error-text">{t("dataTransfer.rolledBack")}</span> : log.failedCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
