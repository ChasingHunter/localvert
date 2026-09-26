import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import { describe, expect, it } from "vitest";
import { isFillableWidget, rectToCssBox } from "./form-layer";

/** Minimal `PdfWidgetAnnoObject` for `isFillableWidget` — only `field.type`
 * matters to that function, so everything else is filler that satisfies the
 * type. */
function widgetOfType(type: PDF_FORM_FIELD_TYPE): PdfWidgetAnnoObject {
  return {
    type: PdfAnnotationSubtype.WIDGET,
    pageIndex: 0,
    id: "w1",
    rect: { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } },
    fontFamily: 0,
    fontSize: 12,
    fontColor: "#000000",
    field: {
      type,
      flag: 0,
      name: "f",
      alternateName: "f",
      value: "",
    } as PdfWidgetAnnoObject["field"],
  };
}

describe("rectToCssBox", () => {
  it("scales a PDF-point rect (top-left origin) into a CSS box", () => {
    const rect = { origin: { x: 10, y: 20 }, size: { width: 100, height: 40 } };
    expect(rectToCssBox(rect, 1.5)).toEqual({
      left: 15,
      top: 30,
      width: 150,
      height: 60,
    });
  });

  it("is the identity mapping at scale 1", () => {
    const rect = { origin: { x: 5, y: 6 }, size: { width: 7, height: 8 } };
    expect(rectToCssBox(rect, 1)).toEqual({
      left: 5,
      top: 6,
      width: 7,
      height: 8,
    });
  });
});

describe("isFillableWidget", () => {
  it("accepts text, checkbox, radio, combobox and listbox fields", () => {
    for (const type of [
      PDF_FORM_FIELD_TYPE.TEXTFIELD,
      PDF_FORM_FIELD_TYPE.CHECKBOX,
      PDF_FORM_FIELD_TYPE.RADIOBUTTON,
      PDF_FORM_FIELD_TYPE.COMBOBOX,
      PDF_FORM_FIELD_TYPE.LISTBOX,
    ]) {
      expect(isFillableWidget(widgetOfType(type))).toBe(true);
    }
  });

  it("rejects push-button, signature and unknown fields", () => {
    for (const type of [
      PDF_FORM_FIELD_TYPE.PUSHBUTTON,
      PDF_FORM_FIELD_TYPE.SIGNATURE,
      PDF_FORM_FIELD_TYPE.UNKNOWN,
    ]) {
      expect(isFillableWidget(widgetOfType(type))).toBe(false);
    }
  });
});
