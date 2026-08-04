import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Search, UserRound, CalendarRange } from "lucide-react";

type RequestWithAuth = <T = unknown>(path: string, options: RequestInit) => Promise<T>;

type ClassItem = {
  _id: string;
  name: string;
};

type ArchiveStudent = {
  _id: string;
  fullName: string;
  regNo?: string;
  rollNumber?: string;
  classId?: string;
  status?: string;
};

type ArchiveItem = {
  _id: string;
  academicYear: string;
  student?: ArchiveStudent;
  classId: string;
  className?: string;
  totals: {
    presentLikeDays: number;
    present: number;
    absent: number;
    late: number;
    halfDay: number;
    totalMarkedDays: number;
  };
  monthly: Array<{
    month: number;
    presentLikeDays: number;
    present: number;
    absent: number;
    late: number;
    halfDay: number;
    totalMarkedDays: number;
  }>;
  finalizedAt?: string;
  presentLikePercentage: number;
};

type ArchiveResponse = {
  academicYear: string;
  availableAcademicYears: string[];
  items: ArchiveItem[];
};

function formatPercentage(value: number) {
  return `${value}%`;
}

function formatMonthLabel(month: number) {
  const date = new Date(Date.UTC(2024, month - 1, 1));
  return date.toLocaleString("en", { month: "short" });
}

export default function PreviousRecordsPage({ requestWithAuth }: { requestWithAuth: RequestWithAuth }) {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [search, setSearch] = useState("");
  const [minPercentage, setMinPercentage] = useState("0");
  const [sortBy, setSortBy] = useState("studentName");
  const [sortOrder, setSortOrder] = useState("asc");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ArchiveItem | null>(null);

  useEffect(() => {
    const loadClasses = async () => {
      try {
        const response = await requestWithAuth<{ items: ClassItem[] }>("/master-data/classes?active=true", { method: "GET" });
        setClasses(response.items ?? []);
      } catch {
        setClasses([]);
      }
    };

    void loadClasses();
  }, [requestWithAuth]);

  useEffect(() => {
    const loadRecords = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedYear) {
          params.set("academicYear", selectedYear);
        }
        if (selectedClass) {
          params.set("classId", selectedClass);
        }
        if (search) {
          params.set("search", search);
        }
        if (minPercentage) {
          params.set("minPercentage", minPercentage);
        }
        if (sortBy) {
          params.set("sortBy", sortBy);
        }
        if (sortOrder) {
          params.set("sortOrder", sortOrder);
        }

        const response = await requestWithAuth<ArchiveResponse>(`/master-data/attendance-archive/records${params.toString() ? `?${params.toString()}` : ""}`, { method: "GET" });
        setItems(response.items ?? []);
        setAvailableYears(response.availableAcademicYears ?? []);
        if (!selectedYear && response.academicYear) {
          setSelectedYear(response.academicYear);
        }
      } catch {
        setItems([]);
        setAvailableYears([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadRecords();
  }, [requestWithAuth, selectedYear, selectedClass, search, minPercentage, sortBy, sortOrder]);

  const filteredItems = useMemo(() => items, [items]);

  useEffect(() => {
    if (!selectedItem && filteredItems.length > 0) {
      setSelectedItem(filteredItems[0]);
    }
  }, [filteredItems, selectedItem]);

  const selectedDisplay = selectedItem ?? filteredItems[0] ?? null;

  return (
    <div className="page-content fade-in" style={{ display: "grid", gap: "1.25rem" }}>
      <section className="panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "999px", background: "rgba(59, 130, 246, 0.16)", display: "grid", placeItems: "center" }}>
            <Archive size={20} color="var(--accent-blue)" />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>{t("archive.title")}</h2>
            <p style={{ margin: "0.25rem 0 0", color: "var(--text-secondary)" }}>{t("archive.subtitle")}</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{t("archive.academicYearLabel")}</span>
            <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem", background: "var(--background)" }}>
              {availableYears.length === 0 ? <option value="">{t("archive.allYears")}</option> : null}
              {availableYears.map((year) => (
                <option value={year} key={year}>{year}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{t("archive.classLabel")}</span>
            <select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem", background: "var(--background)" }}>
              <option value="">{t("archive.allClasses")}</option>
              {classes.map((classItem) => (
                <option value={classItem._id} key={classItem._id}>{classItem.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{t("archive.searchPlaceholder")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem", background: "var(--background)" }}>
              <Search size={16} color="var(--text-secondary)" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("archive.searchPlaceholder")} style={{ border: "none", outline: "none", background: "transparent", width: "100%" }} />
            </div>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{t("archive.minPercentageLabel")}</span>
            <select value={minPercentage} onChange={(event) => setMinPercentage(event.target.value)} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem", background: "var(--background)" }}>
              <option value="0">0%</option>
              <option value="60">60%</option>
              <option value="70">70%</option>
              <option value="80">80%</option>
              <option value="90">90%</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{t("archive.sortByLabel")}</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem", background: "var(--background)" }}>
              <option value="studentName">{t("archive.sortByStudent")}</option>
              <option value="percentage">{t("archive.sortByPercentage")}</option>
              <option value="markedDays">{t("archive.sortByMarked")}</option>
              <option value="finalizedAt">{t("archive.sortByDate")}</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>{t("archive.sortOrderLabel")}</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.6rem 0.75rem", background: "var(--background)" }}>
              <option value="asc">{t("archive.ascending")}</option>
              <option value="desc">{t("archive.descending")}</option>
            </select>
          </label>
        </div>
      </section>

      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1.2fr 0.8fr" }}>
        <section className="panel" style={{ padding: "1rem" }}>
          {isLoading ? (
            <div style={{ padding: "1rem", color: "var(--text-secondary)" }}>{t("archive.loading")}</div>
          ) : filteredItems.length === 0 ? (
            <div style={{ padding: "1rem", color: "var(--text-secondary)" }}>{t("archive.empty")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>{t("archive.studentCol")}</th>
                    <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>{t("archive.classCol")}</th>
                    <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>{t("archive.rateCol")}</th>
                    <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>{t("archive.finalizedCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item._id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => setSelectedItem(item)}>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <UserRound size={16} color="var(--text-secondary)" />
                          <div>
                            <div>{item.student?.fullName ?? t("archive.unknownStudent")}</div>
                            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{item.student?.regNo ?? item.student?.rollNumber ?? ""}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>{item.className ?? ""}</td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>{formatPercentage(item.presentLikePercentage)}</td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <CalendarRange size={14} color="var(--text-secondary)" />
                          <span>{item.finalizedAt ? new Date(item.finalizedAt).toLocaleDateString() : "—"}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" style={{ padding: "1rem", display: "grid", gap: "1rem", alignContent: "start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>{t("archive.detailsTitle")}</h3>
            {selectedDisplay ? <span style={{ color: "var(--text-secondary)" }}>{selectedDisplay.academicYear}</span> : null}
          </div>

          {selectedDisplay ? (
            <>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <div style={{ fontWeight: 600 }}>{selectedDisplay.student?.fullName ?? t("archive.unknownStudent")}</div>
                <div style={{ color: "var(--text-secondary)" }}>{selectedDisplay.className ?? ""}</div>
              </div>
              <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <div className="panel" style={{ padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{t("archive.presentLike")}</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{selectedDisplay.totals.presentLikeDays}</div>
                </div>
                <div className="panel" style={{ padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{t("archive.totalMarked")}</div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{selectedDisplay.totals.totalMarkedDays}</div>
                </div>
              </div>

              <div>
                <h4 style={{ margin: "0 0 0.5rem" }}>{t("archive.monthlyBreakdown")}</h4>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {selectedDisplay.monthly.map((monthItem) => (
                    <div key={`${selectedDisplay._id}-${monthItem.month}`} className="panel" style={{ padding: "0.75rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong>{formatMonthLabel(monthItem.month)}</strong>
                        <span>{formatPercentage(Math.round((monthItem.presentLikeDays / Math.max(monthItem.totalMarkedDays, 1)) * 100))}</span>
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        {t("archive.present")}: {monthItem.present} • {t("archive.absent")}: {monthItem.absent} • {t("archive.late")}: {monthItem.late}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: "var(--text-secondary)" }}>{t("archive.empty")}</div>
          )}
        </section>
      </div>
    </div>
  );
}
