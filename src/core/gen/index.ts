// The in-app generation core, as the desktop runner uses it (design §5.1): what each stage sends
// (bundle, prompts), what its answer must look like (schemas), and the code around every call —
// checks of readings, blueprints, maps and sheets, mechanical repairs, patch ops, id and page
// remapping, diffs, the English merge, findings, the coverage test, the stages and their checkpoints, the prices and the estimate shown before a run. Pure: the runner does the reading, the calls
// and the writing. The prompts are namespaces, as their stages share builder names.

export * from "./squash";
export * from "./limits";
export * from "./checkStructure";
export * from "./checkFormulas";
export * from "./checkEnglish";
export * from "./autofix";
export * from "./ops";
export * from "./remap";
export * from "./diff";
export * from "./anchors";
export * from "./figures";
export * from "./schemas";
export * from "./bundle";
export * from "./reading";
export * from "./context";
export * from "./blueprint";
export * from "./draft";
export * from "./mergeEnglish";
export * from "./findings";
export * from "./coverage";
export * from "./pipeline";
export type { InputPart, Prompt } from "./prompts/structure";
export * as structurePrompts from "./prompts/structure";
export * as formulaPrompts from "./prompts/formulas";
export * as englishPrompts from "./prompts/english";
export * as coveragePrompts from "./prompts/coverage";
export * as readerPrompts from "./prompts/reader";
