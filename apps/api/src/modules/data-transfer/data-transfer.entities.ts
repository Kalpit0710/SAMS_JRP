import { buildCsv, parseCsv } from "../../lib/csv.js";
import { ClassModel } from "../../models/class.model.js";
import { StudentModel } from "../../models/student.model.js";
import { TeacherModel } from "../../models/teacher.model.js";

export type RowError = { row: number; message: string };

export type BuildResult = {
  docs: Array<Record<string, unknown>>;
  errors: RowError[];
};

type InsertableModel = {
  insertMany: (docs: Array<Record<string, unknown>>, options: { ordered: boolean }) => Promise<unknown>;
  deleteMany: (filter: Record<string, unknown>) => Promise<unknown>;
};

export type EntityDefinition = {
  key: string;
  label: string;
  columns: string[];
  required: string[];
  sample: Record<string, string>;
  model: InsertableModel;
  exportRows: () => Promise<Array<Record<string, unknown>>>;
  build: (rows: Array<Record<string, string>>) => Promise<BuildResult>;
};

function pick(row: Record<string, string>, column: string) {
  return (row[column] ?? "").trim();
}

function parseBoolean(value: string, fallback = true) {
  if (!value) {
    return fallback;
  }
  return ["true", "yes", "1", "y", "active"].includes(value.toLowerCase());
}

/** Class names are the natural key in this school, matched case-insensitively. */
function classKey(name: string) {
  return name.trim().toLowerCase();
}

function formatDate(value: Date | null | undefined) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function parseDob(value: string): { date?: Date; error?: string } {
  if (!value) {
    return {};
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: `Invalid dob "${value}" - use YYYY-MM-DD` };
  }

  return { date };
}

/* ------------------------------------------------------------------ classes */

const classesEntity: EntityDefinition = {
  key: "classes",
  label: "Classes",
  columns: ["name", "isActive"],
  required: ["name"],
  sample: { name: "Class 5", isActive: "true" },
  model: ClassModel as unknown as InsertableModel,
  exportRows: async () => {
    const items = await ClassModel.find({}).sort({ name: 1 }).lean();
    return items.map((item) => ({
      name: item.name,
      isActive: String(item.isActive ?? true)
    }));
  },
  build: async (rows) => {
    const docs: Array<Record<string, unknown>> = [];
    const errors: RowError[] = [];
    const seen = new Set<string>();

    const existing = await ClassModel.find({}).select("name").lean();
    const existingKeys = new Set(existing.map((item) => classKey(item.name)));

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const name = pick(row, "name");

      if (!name) {
        errors.push({ row: rowNumber, message: "name is required" });
        return;
      }

      const key = classKey(name);
      if (seen.has(key)) {
        errors.push({ row: rowNumber, message: `Duplicate row for ${name}` });
        return;
      }
      if (existingKeys.has(key)) {
        errors.push({ row: rowNumber, message: `Class ${name} already exists` });
        return;
      }

      seen.add(key);
      docs.push({ name, isActive: parseBoolean(pick(row, "isActive")) });
    });

    return { docs, errors };
  }
};

/* ----------------------------------------------------------------- teachers */

const teachersEntity: EntityDefinition = {
  key: "teachers",
  label: "Teachers",
  columns: ["fullName", "className", "phoneNumber", "isActive"],
  required: ["fullName"],
  sample: {
    fullName: "Sunita Sharma",
    className: "Class 5",
    phoneNumber: "9876500011",
    isActive: "true"
  },
  model: TeacherModel as unknown as InsertableModel,
  exportRows: async () => {
    const [teachers, classes] = await Promise.all([
      TeacherModel.find({}).sort({ fullName: 1 }).lean(),
      ClassModel.find({}).lean()
    ]);
    const classById = new Map(classes.map((item) => [String(item._id), item]));

    return teachers.map((item) => ({
      fullName: item.fullName,
      className: item.classId ? classById.get(String(item.classId))?.name ?? "" : "",
      phoneNumber: item.phoneNumber ?? "",
      isActive: String(item.isActive ?? true)
    }));
  },
  build: async (rows) => {
    const docs: Array<Record<string, unknown>> = [];
    const errors: RowError[] = [];
    const seen = new Set<string>();

    const [classes, teachers] = await Promise.all([
      ClassModel.find({}).select("name").lean(),
      TeacherModel.find({}).select("fullName").lean()
    ]);
    const classByName = new Map(classes.map((item) => [classKey(item.name), item]));
    const existingNames = new Set(teachers.map((item) => item.fullName.toLowerCase()));

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const fullName = pick(row, "fullName");
      const className = pick(row, "className");

      if (!fullName) {
        errors.push({ row: rowNumber, message: "fullName is required" });
        return;
      }
      if (seen.has(fullName.toLowerCase())) {
        errors.push({ row: rowNumber, message: `Duplicate row for ${fullName}` });
        return;
      }
      if (existingNames.has(fullName.toLowerCase())) {
        errors.push({ row: rowNumber, message: `Teacher ${fullName} already exists` });
        return;
      }

      let classId: unknown;
      if (className) {
        const parentClass = classByName.get(classKey(className));
        if (!parentClass) {
          errors.push({ row: rowNumber, message: `No class found named "${className}"` });
          return;
        }
        classId = parentClass._id;
      }

      seen.add(fullName.toLowerCase());
      docs.push({
        fullName,
        classId,
        phoneNumber: pick(row, "phoneNumber") || undefined,
        isActive: parseBoolean(pick(row, "isActive"))
      });
    });

    return { docs, errors };
  }
};

/* ----------------------------------------------------------------- students */

const studentsEntity: EntityDefinition = {
  key: "students",
  label: "Students",
  columns: [
    "regNo",
    "fullName",
    "className",
    "rollNumber",
    "dob",
    "fatherName",
    "motherName",
    "phoneNumber",
    "status"
  ],
  required: ["regNo", "fullName", "className"],
  sample: {
    regNo: "24307",
    fullName: "Abdul Mannan Khan",
    className: "Class 1",
    rollNumber: "1",
    dob: "2020-04-08",
    fatherName: "Mr. Naved Khan",
    motherName: "Mrs. Farhana Bee",
    phoneNumber: "9876543210",
    status: "active"
  },
  model: StudentModel as unknown as InsertableModel,
  exportRows: async () => {
    const [students, classes] = await Promise.all([
      StudentModel.find({}).sort({ classId: 1, rollNumber: 1 }).lean(),
      ClassModel.find({}).lean()
    ]);
    const classById = new Map(classes.map((item) => [String(item._id), item]));

    return students.map((student) => ({
      regNo: student.regNo,
      fullName: student.fullName,
      className: classById.get(String(student.classId))?.name ?? "",
      rollNumber: student.rollNumber ?? "",
      dob: formatDate(student.dob),
      fatherName: student.fatherName ?? "",
      motherName: student.motherName ?? "",
      phoneNumber: student.phoneNumber ?? "",
      status: student.status ?? "active"
    }));
  },
  build: async (rows) => {
    const docs: Array<Record<string, unknown>> = [];
    const errors: RowError[] = [];
    const seen = new Set<string>();

    const [classes, students] = await Promise.all([
      ClassModel.find({}).select("name").lean(),
      StudentModel.find({}).select("regNo").lean()
    ]);

    const classByName = new Map(classes.map((item) => [classKey(item.name), item]));
    const existingRegNos = new Set(students.map((item) => item.regNo));

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const regNo = pick(row, "regNo");
      const fullName = pick(row, "fullName");
      const className = pick(row, "className");

      if (!regNo || !fullName || !className) {
        errors.push({ row: rowNumber, message: "regNo, fullName and className are required" });
        return;
      }

      if (seen.has(regNo)) {
        errors.push({ row: rowNumber, message: `Duplicate row for regNo ${regNo}` });
        return;
      }
      if (existingRegNos.has(regNo)) {
        errors.push({ row: rowNumber, message: `Student ${regNo} already exists` });
        return;
      }

      const parentClass = classByName.get(classKey(className));
      if (!parentClass) {
        errors.push({ row: rowNumber, message: `No class found named "${className}"` });
        return;
      }

      const status = pick(row, "status").toLowerCase() || "active";
      if (!["active", "inactive"].includes(status)) {
        errors.push({ row: rowNumber, message: `status must be active or inactive (got "${status}")` });
        return;
      }

      const dob = parseDob(pick(row, "dob"));
      if (dob.error) {
        errors.push({ row: rowNumber, message: dob.error });
        return;
      }

      seen.add(regNo);
      docs.push({
        regNo,
        fullName,
        classId: parentClass._id,
        rollNumber: pick(row, "rollNumber") || undefined,
        dob: dob.date,
        fatherName: pick(row, "fatherName") || undefined,
        motherName: pick(row, "motherName") || undefined,
        phoneNumber: pick(row, "phoneNumber") || undefined,
        status
      });
    });

    return { docs, errors };
  }
};

export const ENTITY_DEFINITIONS: Record<string, EntityDefinition> = {
  classes: classesEntity,
  teachers: teachersEntity,
  students: studentsEntity
};

export function getEntity(key: string) {
  return Object.prototype.hasOwnProperty.call(ENTITY_DEFINITIONS, key) ? ENTITY_DEFINITIONS[key] : null;
}

export function buildTemplate(entity: EntityDefinition) {
  return buildCsv(entity.columns, [entity.sample]);
}

export function readImportRows(csv: string) {
  return parseCsv(csv);
}
