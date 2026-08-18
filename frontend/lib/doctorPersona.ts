/** Persistent Pakistani doctor persona per student (Ask AI tutor identity). */

export type DoctorPersona = {
  title: "Dr";
  name: string;
  gender: "female";
  /** Short label e.g. "Dr. Ayesha" */
  displayName: string;
  initials: string;
  /** HSL hue 0–360 for avatar background */
  hue: number;
};

/** Female-only pool — TTS is a female voice. Same name can repeat after the list wraps. */
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
  "Areeba",
  "Mehwish",
  "Nimra",
  "Hania",
  "Alina",
  "Saba",
  "Farah",
  "Bushra",
  "Nadia",
  "Samina",
  "Hina",
  "Komal",
  "Anam",
  "Sadia",
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
  const name = FEMALE_NAMES[h % FEMALE_NAMES.length];
  const initials = `D${name.charAt(0)}`.toUpperCase();
  return {
    title: "Dr",
    name,
    gender: "female",
    displayName: `Dr. ${name}`,
    initials,
    hue: h % 360,
  };
}

const STORAGE_PREFIX = "uraan_doctor_v2_";

/** Stable doctor for this student across sessions (localStorage). */
export function getDoctorPersona(studentId: string | null | undefined): DoctorPersona {
  const id = (studentId || "guest").trim() || "guest";
  if (typeof window === "undefined") return buildPersona(id);
  const key = `${STORAGE_PREFIX}${id}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as DoctorPersona;
      if (
        parsed?.displayName &&
        parsed?.gender === "female" &&
        parsed?.initials != null &&
        parsed?.hue != null
      ) {
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
