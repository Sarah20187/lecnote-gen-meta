// Re-declared for this repository. In LecNote (the pre-existing app, private) this type lives in
// packages/core/src/course.ts, written before the hackathon. The generation core only needs its shape,
// so it is declared again here instead of copying the pre-existing file.

export interface ExamInfo {
  /** midterm, final, quiz … */
  exam: string;
  /** YYYY-MM-DD, or "" when unknown. */
  date: string;
  /** e.g. closed-book multiple choice, or "" when unknown. */
  form: string;
  language: "en" | "zh" | "unknown";
  /** Sample and past papers in the course folder: a file name, or `file#p<page>`. */
  files: string[];
}
