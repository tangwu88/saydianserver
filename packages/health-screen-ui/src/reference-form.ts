// Vue number inputs may yield either numbers or strings; a blank optional lab field is absent.
export function referenceFormValues(
  fields: Record<string, string | number | null | undefined>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(
        ([, value]) =>
          value !== null && value !== undefined && String(value).trim() !== "",
      )
      .map(([key, value]) => [key, Number(value)]),
  );
}
