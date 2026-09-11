/** Render only useful scalar details; never dump an arbitrary error object or its stack. */
export function formatSplitFailure(error: unknown, limits: { readonly summaryBytes: number; readonly detailBytes: number }): string {
  if (typeof error !== "object" || error === null) return "The story split failed.";
  const record = error as Record<string, unknown>;
  const code = typeof record["code"] === "string" ? record["code"] : "Error";
  const message = typeof record["message"] === "string" ? record["message"] : "The story split failed.";
  const summaryBytes = Buffer.from(`${code}: ${message}`, "utf8");
  const summary = summaryBytes.byteLength <= limits.summaryBytes
    ? summaryBytes.toString("utf8")
    : `${summaryBytes.subarray(0, limits.summaryBytes).toString("utf8")} [summary truncated]`;
  const details = record["details"];
  if (typeof details !== "object" || details === null) return summary;
  const fields = details as Record<string, unknown>;
  const lines = [summary];
  let remaining = limits.detailBytes;
  const stderr = fields["stderr"];
  if (typeof stderr === "string" && stderr.length > 0) {
    const bytes = Buffer.from(stderr, "utf8");
    const truncated = bytes.byteLength > remaining;
    const selected = truncated ? bytes.subarray(bytes.byteLength - remaining) : bytes;
    lines.push(truncated ? `Process stderr (last ${remaining} bytes; earlier output omitted):` : "Process stderr:", selected.toString("utf8").trimEnd());
    remaining -= selected.byteLength;
  }
  for (const key of ["segmentId", "stage", "exitCode", "executable", "path"]) {
    const value = fields[key];
    if (remaining <= 0 || (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)))) continue;
    const bytes = Buffer.from(`${key}: ${value}`, "utf8");
    const selected = bytes.subarray(0, remaining);
    lines.push(selected.toString("utf8") + (selected.byteLength < bytes.byteLength ? " [detail truncated]" : ""));
    remaining -= selected.byteLength;
  }
  return lines.join("\n");
}
