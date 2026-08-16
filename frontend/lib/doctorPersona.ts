/** Persistent Pakistani doctor persona per student (Ask AI tutor identity). */

export type DoctorPersona = {
  title: "Dr";
  name: string;
  gender: "male" | "female";
  /** Short label e.g. "Dr. Atif" */
  displayName: string;
  initials: string;
  /** HSL hue 0–360 for avatar background */
  hue: number;
};

const MALE_NAMES = [
  "Atif",
  "Hassan",
  "Bilal",
  "Usman",
  "Hamza",
  "Ahmed",
  "Imran",
  "Faisal",
  "Omar",
  "Saad",
  "Zain",
  "Asad",
  "Taha",
  "Danish",
  "Nabeel",
  "Haris",
  "Rayyan",
  "Ibrahim",
];

const FEMALE_NAMES = [
  "Ayesha",
  "Fatima",
  "Sana",
  "Hira",
  "Maryam",
  "Zara",
  "Amna",
  "Rabia",
  "Noor",
  "Maham",
  "Sara",
  "Iqra",
  "Laiba",
  "Amina",
  "Khadija",
  "Hafsa",
  "Mahnoor",
  "Eman",
];

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function buildPersona(studentId: string): DoctorPersona {
  const h = hashId(studentId || "guest");
  const female = h % 2 === 0;
  const pool = female ? FEMALE_NAMES : MALE_NAMES;
  const name = pool[h % pool.length];
  const initials = `D${name.charAt(0)}`.toUpperCase();
  return {
    title: "Dr",
    name,
    gender: female ? "female" : "male",
    displayName: `Dr. ${name}`,
    initials,
    hue: h % 360,
  };
}

const STORAGE_PREFIX = "uraan_doctor_v1_";

/** Stable doctor for this student across sessions (localStorage). */
export function getDoctorPersona(studentId: string | null | undefined): DoctorPersona {
  const id = (studentId || "guest").trim() || "guest";
  if (typeof window === "undefined") return buildPersona(id);
  const key = `${STORAGE_PREFIX}${id}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as DoctorPersona;
      if (parsed?.displayName && parsed?.initials != null && parsed?.hue != null) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  const persona = buildPersona(id);
  try {
    window.localStorage.setItem(key, JSON.stringify(persona));
  } catch {
    /* ignore */
  }
  return persona;
}
