/**
 * API types, split by domain (contract r4 §5). Import from "@/types/api": this barrel
 * re-exports every module so existing imports keep working.
 */
export type * from "./common";
export type * from "./auth";
export type * from "./catalog";
export type * from "./pbq";
export type * from "./sessions";
export type * from "./runner";
export type * from "./study";
export type * from "./analytics";
export type * from "./admin";
