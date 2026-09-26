"use client";

import { useDocumentState, useRegistry } from "@embedpdf/core/react";
import {
  type FormFieldValue,
  isWidgetChecked,
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  type PdfWidgetAnnoObject,
  type Rect,
} from "@embedpdf/models";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Slice E2a — form filling. Renders one absolutely positioned HTML control
 * per fillable widget on a page, on top of `AnnotationLayer` (see
 * `pdf-editor-app.tsx`'s `renderPage`). Every value change goes straight to
 * `engine.setFormFieldValue`, which mutates the open document's live PDFium
 * state — there's no separate "form state" to keep in sync with the
 * rendered appearance the way `@embedpdf/plugin-annotation` needs one for
 * undo/redo, so this stays a plain, uncontrolled-ish overlay rather than a
 * plugin.
 *
 * `@embedpdf/plugin-form` (unlicensed, per ADR-0009) is never imported here
 * or anywhere else — this talks to the bare `PdfEngine` methods directly
 * (`getPageAnnoWidgets` / `setFormFieldValue`), which `pdfium.worker.ts`'s
 * generic `EngineRunner` already forwards (confirmed against
 * `@embedpdf/engines/dist/index.js`'s `case "getPageAnnoWidgets"` /
 * `"setFormFieldValue"` — `regenerateWidgetAppearances` is NOT forwarded,
 * so it's never called from here).
 */

/** Field types this layer renders a control for. Signature and push-button
 * widgets are skipped — signatures are E2b's job, and a push-button has no
 * value to fill (it triggers an action, which this editor doesn't run). */
const FILLABLE_TYPES = new Set<PDF_FORM_FIELD_TYPE>([
  PDF_FORM_FIELD_TYPE.TEXTFIELD,
  PDF_FORM_FIELD_TYPE.CHECKBOX,
  PDF_FORM_FIELD_TYPE.RADIOBUTTON,
  PDF_FORM_FIELD_TYPE.COMBOBOX,
  PDF_FORM_FIELD_TYPE.LISTBOX,
]);

/** True if `widget` is a field type this layer can render a control for. */
export function isFillableWidget(widget: PdfWidgetAnnoObject): boolean {
  return FILLABLE_TYPES.has(widget.field.type);
}

/** A widget's PDF-point `rect` (see `@embedpdf/models`'s `Rect` — an
 * `origin`/`size` pair, top-left, already in the same convention
 * `@embedpdf/plugin-annotation`'s own screen-bounds helper uses: `left =
 * rect.origin.x * scale`, `top = rect.origin.y * scale` with no y-flip — see
 * `getAnnotationScreenBounds` in that plugin's built `react/index.js`) into
 * an absolutely positioned CSS box at the page's current render `scale`
 * (`DocumentState.scale`, the same value `AnnotationLayer` reads for its own
 * `actualScale` fallback). Exported for unit testing. */
export function rectToCssBox(
  rect: Rect,
  scale: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: rect.origin.x * scale,
    top: rect.origin.y * scale,
    width: rect.size.width * scale,
    height: rect.size.height * scale,
  };
}

interface FormLayerProps {
  documentId: string;
  pageIndex: number;
  /** True while an annotation tool is active — the layer renders nothing so
   * pointer events reach the page for drawing (see `EMBEDPDF_NOTES.md`'s
   * gotcha list: this overlay must never compete with the annotation
   * gesture layer for a drag). */
  toolActive: boolean;
  /** Reports this page's fillable widgets up to `Editor` once loaded, so it
   * can decide whether to show the "Flatten forms" export checkbox at all
   * (never shown for a document with no form fields). Called with `[]` if
   * the page has none, so a previously-fillable page that turns out empty
   * still clears itself from the parent's set. */
  onWidgetsLoaded?: (pageIndex: number, widgets: PdfWidgetAnnoObject[]) => void;
}

/** Debounce delay for a text field's `onChange` -> `setFormFieldValue`
 * commit. Checkbox/radio/select fields commit immediately on change —
 * there's no keystroke stream to coalesce. */
const TEXT_COMMIT_DEBOUNCE_MS = 250;

export function FormLayer({
  documentId,
  pageIndex,
  toolActive,
  onWidgetsLoaded,
}: FormLayerProps) {
  const { registry } = useRegistry();
  const engine = registry?.getEngine() ?? null;
  const documentState = useDocumentState(documentId);
  const doc = documentState?.document ?? null;
  const page = doc?.pages[pageIndex] ?? null;
  const scale = documentState?.scale ?? 1;

  const [widgets, setWidgets] = useState<PdfWidgetAnnoObject[]>([]);

  // Loaded once per document+page: widget geometry and field metadata don't
  // change from user input (only `field.value` does, which we track locally
  // per control below rather than re-fetching the whole widget list on every
  // keystroke).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on doc/page identity (doc?.id, page?.index), not the doc/page/onWidgetsLoaded object references themselves — those can change every render and would reload widgets on every keystroke.
  useEffect(() => {
    if (!engine || !doc || !page) {
      setWidgets([]);
      onWidgetsLoaded?.(pageIndex, []);
      return;
    }
    let cancelled = false;
    engine
      .getPageAnnoWidgets(doc, page)
      .toPromise()
      .then((result) => {
        if (cancelled) return;
        setWidgets(result);
        onWidgetsLoaded?.(pageIndex, result);
      })
      .catch(() => {
        if (cancelled) return;
        setWidgets([]);
        onWidgetsLoaded?.(pageIndex, []);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, doc?.id, page?.index, pageIndex]);

  const commit = useCallback(
    (widget: PdfWidgetAnnoObject, value: FormFieldValue) => {
      if (!engine || !doc || !page) return;
      void engine.setFormFieldValue(doc, page, widget, value).toPromise();
    },
    [engine, doc, page],
  );

  if (toolActive || widgets.length === 0) return null;

  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      data-form-layer
    >
      {widgets.filter(isFillableWidget).map((widget) => (
        <FormControl
          key={widget.id}
          widget={widget}
          box={rectToCssBox(widget.rect, scale)}
          onCommit={(value) => commit(widget, value)}
        />
      ))}
    </div>
  );
}

interface FormControlProps {
  widget: PdfWidgetAnnoObject;
  box: { left: number; top: number; width: number; height: number };
  onCommit: (value: FormFieldValue) => void;
}

/** Renders the one control matching `widget.field.type`. Accessible label
 * text falls back to the field's alternate (tooltip) name, then its raw
 * name, since a name like "topmostSubform[0].field[3]" is what most
 * generated forms actually store. */
function FormControl({ widget, box, onCommit }: FormControlProps) {
  const field = widget.field;
  const label = field.alternateName || field.name;
  const style: React.CSSProperties = {
    position: "absolute",
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    pointerEvents: "auto",
    boxSizing: "border-box",
    font: "inherit",
    fontSize: Math.max(10, Math.min(box.height * 0.7, 16)),
  };
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [textDraft, setTextDraft] = useState(
    field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD ? field.value : "",
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets the draft only when the widget identity changes (a different field), not on every value change — this is the field's *initial* value, not a controlled mirror of it.
  useEffect(() => {
    if (field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD) setTextDraft(field.value);
  }, [widget.id]);

  const flushText = useCallback(
    (text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      onCommit({ kind: "text", text });
    },
    [onCommit],
  );

  const scheduleText = useCallback(
    (text: string) => {
      setTextDraft(text);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onCommit({ kind: "text", text });
      }, TEXT_COMMIT_DEBOUNCE_MS);
    },
    [onCommit],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD) {
    const multiline = (field.flag & PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE) !== 0;
    const commonProps = {
      "aria-label": label,
      value: textDraft,
      maxLength: field.maxLen,
      className:
        "rounded-sm border border-border bg-surface/90 px-1 text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent",
      style,
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => scheduleText(e.target.value),
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        flushText(e.target.value),
    };
    return multiline ? (
      <textarea {...commonProps} />
    ) : (
      <input type="text" {...commonProps} />
    );
  }

  if (field.type === PDF_FORM_FIELD_TYPE.CHECKBOX) {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={isWidgetChecked(widget)}
        style={style}
        onChange={(e) =>
          onCommit({ kind: "checked", checked: e.target.checked })
        }
      />
    );
  }

  if (field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON) {
    return (
      <input
        type="radio"
        name={field.name}
        aria-label={label}
        checked={isWidgetChecked(widget)}
        style={style}
        onChange={(e) => {
          if (e.target.checked) onCommit({ kind: "checked", checked: true });
        }}
      />
    );
  }

  if (
    field.type === PDF_FORM_FIELD_TYPE.COMBOBOX ||
    field.type === PDF_FORM_FIELD_TYPE.LISTBOX
  ) {
    const selectedIndex = field.options.findIndex((o) => o.isSelected);
    return (
      <select
        aria-label={label}
        multiple={field.type === PDF_FORM_FIELD_TYPE.LISTBOX}
        value={selectedIndex >= 0 ? String(selectedIndex) : ""}
        className="rounded-sm border border-border bg-surface/90 text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent"
        style={style}
        onChange={(e) => {
          const index = Number(e.target.value);
          onCommit({ kind: "selection", index, isSelected: true });
        }}
      >
        <option value="" disabled hidden>
          {" "}
        </option>
        {field.options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an option's index IS its identity here — `FormFieldValue`'s `selection` variant addresses options by index, and PDF form option lists don't reorder at runtime.
          <option key={index} value={index}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return null;
}
