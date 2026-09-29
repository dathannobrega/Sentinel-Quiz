"use client";

import { pbqStyles as pbq } from "@/features/session-runner/components/pbq/pbq-shared";
import type { NormalizedExhibit } from "@/features/session-runner/lib/pbq-utils";
import type { Translate } from "@/features/session-runner/lib/runner-utils";

type HeadingTag = "h2" | "h3" | "h4" | "h5";

/** Read-only exhibits (text, log, table) shown next to the scenario. */
export function PbqExhibits({
  exhibits,
  headingTag,
  t
}: {
  exhibits: NormalizedExhibit[];
  headingTag: HeadingTag;
  t: Translate;
}) {
  if (!exhibits.length) {
    return null;
  }
  const Heading = headingTag;
  return (
    <div className={pbq.exhibits}>
      {exhibits.map((exhibit, index) => {
        const title = exhibit.title || t("pbq.exhibitFallbackTitle", { number: index + 1 });
        return (
          <section key={exhibit.id} className={pbq.exhibit} aria-label={title} data-testid={`pbq-exhibit-${exhibit.id}`}>
            <Heading className={pbq.exhibitTitle}>{title}</Heading>
            {exhibit.type === "table" ? (
              <div className={pbq.tableWrap}>
                <table className={pbq.table}>
                  <thead>
                    <tr>
                      {exhibit.columns.map((column, columnIndex) => (
                        <th key={`${column}-${columnIndex}`} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exhibit.rows.map((row) => (
                      <tr key={row.id}>
                        {row.cells.map((cell, cellIndex) => (
                          <td key={cellIndex}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : exhibit.type === "log" ? (
              <ol className={pbq.log}>
                {exhibit.lines.map((line) => (
                  <li key={line.id}>
                    <code>{line.text}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <div className={pbq.exhibitText}>{exhibit.content}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}
