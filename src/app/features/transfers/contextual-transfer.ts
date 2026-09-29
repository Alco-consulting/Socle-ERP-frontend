/**
 * What a domain says about ITS import and export (route data `transfer`): the API types,
 * the permissions of the domain on top of the `imports_exports.*` ones, and its words.
 * Only the operations the API offers are described (V1: partners import and export).
 */
export interface ContextualTransfer {
  /** `ImportType` of the API; `null`: no import for this domain. */
  readonly importType: string | null;
  /** `ExportType` of the API; `null`: no export for this domain. */
  readonly exportType: string | null;
  /** Permission of the domain needed to import (`partners.create`) and to export. */
  readonly importPermission: string;
  readonly exportPermission: string;
  readonly importLabel: string;
  readonly exportLabel: string;
  /** « Import de tiers » */
  readonly importTitle: string;
  /** What the import creates, in one sentence. */
  readonly importEffect: string;
  /** Key of the created objects in the preview (`partners`). */
  readonly creationKey: string;
  /** « 3 tiers » */
  readonly countLabel: (count: number) => string;
  /** Field of the importer → words of the user. */
  readonly fieldLabels: Readonly<Record<string, string>>;
  /** Back to the domain's list. */
  readonly backLabel: string;
}

/** The fields of an import the user maps, in the importer's order. */
export function fieldLabel(transfer: ContextualTransfer, field: string): string {
  return transfer.fieldLabels[field] ?? field;
}
