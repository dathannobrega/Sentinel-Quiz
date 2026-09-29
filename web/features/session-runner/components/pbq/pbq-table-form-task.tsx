"use client";

import { useId } from "react";

import { PbqItemExplanation, PbqMark, type PbqTaskProps } from "@/features/session-runner/components/pbq/pbq-shared";
import {
  cellChoices,
  cellInputKind,
  formatCellSolution,
  isCellValueAccepted,
  isEditableCell
} from "@/features/session-runner/lib/pbq-utils";
import type { PbqTableFormResponse, PbqTableFormTask } from "@/types/api";

/** Table form: fixed cells are text; editable cells are labelled selects or text/number inputs. */
export function PbqTableFormTask({
  task,
  value,
  onChange,
  disabled,
  solution,
  perItem,
  labelledBy,
  t
}: PbqTaskProps<PbqTableFormTask, PbqTableFormResponse>) {
  const baseId = useId();
  const columns = task.columns ?? [];
  const rows = task.rows ?? [];
  const expected = solution?.type === "table_form" ? solution.cells : null;

  function setCell(rowId: string, columnId: string, cellValue: string) {
    if (disabled) {
      return;
    }
    const nextRow = { ...(value[rowId] ?? {}) };
    if (cellValue === "") {
      delete nextRow[columnId];
    } else {
      nextRow[columnId] = cellValue;
    }
    onChange({ ...value, [rowId]: nextRow });
  }

  return (
    <div className="sq-pbq-task-body">
      <div className="sq-pbq-table-wrap">
        <table className="sq-pbq-table" aria-labelledby={labelledBy}>
          <thead>
            <tr>
              <th scope="col">{t("pbq.tableForm.rowHeader")}</th>
              {columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowLabel = row.label || row.id;
              return (
                <tr key={row.id} data-testid={`pbq-row-${row.id}`}>
                  <th scope="row">
                    {rowLabel}
                    {expected ? <PbqItemExplanation text={perItem[row.id]} /> : null}
                  </th>
                  {columns.map((column) => {
                    const cell = row.cells?.[column.id];
                    if (!isEditableCell(cell)) {
                      const fixed = cell?.value;
                      return <td key={column.id}>{fixed === null || fixed === undefined ? "" : String(fixed)}</td>;
                    }
                    const controlId = `${baseId}-${row.id}-${column.id}`;
                    const label = t("pbq.tableForm.cellLabel", {
                      row: rowLabel,
                      column: column.label
                    });
                    const kind = cellInputKind(column, cell);
                    const current = value[row.id]?.[column.id];
                    const currentText = current === undefined ? "" : String(current);
                    const cellSolution = expected?.[row.id]?.[column.id] ?? null;
                    return (
                      <td key={column.id}>
                        {kind === "select" ? (
                          <select
                            id={controlId}
                            aria-label={label}
                            className="sq-select sq-pbq-table__control"
                            value={currentText}
                            disabled={disabled}
                            onChange={(event) => setCell(row.id, column.id, event.target.value)}
                          >
                            <option value="">{t("pbq.tableForm.placeholder")}</option>
                            {cellChoices(column, cell).map((choice) => (
                              <option key={choice} value={choice}>
                                {choice}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={controlId}
                            aria-label={label}
                            className="sq-input sq-pbq-table__control"
                            type="text"
                            inputMode={kind === "number" ? "decimal" : undefined}
                            placeholder={kind === "number" ? t("pbq.tableForm.numberPlaceholder") : undefined}
                            value={currentText}
                            disabled={disabled}
                            onChange={(event) => setCell(row.id, column.id, event.target.value)}
                          />
                        )}
                        {cellSolution ? (
                          <PbqMark ok={isCellValueAccepted(cellSolution, current)}>
                            {isCellValueAccepted(cellSolution, current)
                              ? t("pbq.marks.correct")
                              : t("pbq.tableForm.expected", {
                                  value: formatCellSolution(cellSolution)
                                })}
                          </PbqMark>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
