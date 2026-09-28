import { describe, expect, it } from "vitest";

import { enUSMessages } from "@/lib/i18n/locales/en-us";
import { ptBRMessages } from "@/lib/i18n/locales/pt-br";

type Shape = string[];

/** Flattens a catalog into "path:type" entries (arrays compared by length and item shape). */
function describeShape(value: unknown, path = ""): Shape {
  if (Array.isArray(value)) {
    return [`${path}:array(${value.length})`, ...value.flatMap((item, index) => describeShape(item, `${path}[${index}]`))];
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => describeShape((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return [`${path}:${typeof value}`];
}

function placeholders(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    const tokens = Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
    return [`${path}=${tokens.join(",")}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => placeholders(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => placeholders((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return [];
}

function emptyStrings(value: unknown, path = ""): string[] {
  if (typeof value === "string") {
    return value.trim() ? [] : [path];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => emptyStrings(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      emptyStrings(item, path ? `${path}.${key}` : key)
    );
  }
  return [];
}

describe("i18n catalogs", () => {
  it("pt-BR and en-US have exactly the same keys and shapes", () => {
    const pt = describeShape(ptBRMessages);
    const en = describeShape(enUSMessages);
    expect(en.filter((entry) => !pt.includes(entry))).toEqual([]);
    expect(pt.filter((entry) => !en.includes(entry))).toEqual([]);
  });

  it("use the same interpolation placeholders in both locales", () => {
    expect(placeholders(enUSMessages)).toEqual(placeholders(ptBRMessages));
  });

  it("have no empty strings", () => {
    expect(emptyStrings(ptBRMessages)).toEqual([]);
    expect(emptyStrings(enUSMessages)).toEqual([]);
  });
});
