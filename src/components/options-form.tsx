"use client";

import { useId } from "react";
import type { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  describeFields,
  type FieldSpec,
  isFieldVisible,
  validateOptions,
} from "@/lib/options/fields";

interface OptionsFormProps<S extends z.ZodObject> {
  schema: S;
  /** Fallback for a key missing from `value` — `value` itself always wins. */
  defaults?: z.infer<S>;
  value: z.infer<S>;
  onChange: (value: z.infer<S>) => void;
  disabled?: boolean;
}

/**
 * Renders a tool's options schema as a form — one control per field, derived
 * by `describeFields`. Fully controlled: the parent owns `value` and gets a
 * new object on every change, and owns the action (convert/cancel) buttons —
 * this component renders no submit control of its own.
 */
export function OptionsForm<S extends z.ZodObject>({
  schema,
  defaults,
  value,
  onChange,
  disabled = false,
}: OptionsFormProps<S>) {
  // A "crop" field never gets a generic row here — `ToolRunner` renders a
  // dedicated `CropEditor` for it instead (see crop-editor.tsx), and no
  // sensible x/y/width/height control exists without the dropped image's
  // own dimensions, which this form never has.
  const fields = describeFields(schema).filter((f) => f.control !== "crop");
  const result = validateOptions(schema, value);
  const errors = result.ok ? {} : result.errors;

  const record = value as Record<string, unknown>;
  const defaultRecord = defaults as Record<string, unknown> | undefined;
  // `defaultRecord` first, `record` on top: the same fallback order every
  // individual field's own `value` prop below already uses, so a `showWhen`
  // reading a field the user hasn't touched yet still sees its default.
  const effectiveValues = { ...defaultRecord, ...record };

  const setField = (key: string, fieldValue: unknown) => {
    onChange({ ...record, [key]: fieldValue } as z.infer<S>);
  };

  return (
    <div className="flex flex-col gap-5">
      {fields
        .filter((field) => isFieldVisible(field, effectiveValues))
        .map((field) => (
          <OptionField
            key={field.key}
            field={field}
            value={record[field.key] ?? defaultRecord?.[field.key]}
            error={errors[field.key]}
            disabled={disabled}
            onChange={(fieldValue) => setField(field.key, fieldValue)}
          />
        ))}
    </div>
  );
}

interface OptionFieldProps {
  field: FieldSpec;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

function OptionField({
  field,
  value,
  error,
  disabled,
  onChange,
}: OptionFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [field.help ? helpId : null, error ? errorId : null]
      .filter((v) => v !== null)
      .join(" ") || undefined;

  const control = (
    <FieldControl
      id={id}
      field={field}
      value={value}
      disabled={disabled}
      describedBy={describedBy}
      onChange={onChange}
    />
  );
  const help = field.help && (
    <p id={helpId} className="text-xs text-ink-muted">
      {field.help}
    </p>
  );
  const fieldError = error && (
    <p id={errorId} className="text-xs text-danger">
      {error}
    </p>
  );

  // A switch reads as a single on/off row — label and help on the left,
  // the toggle itself on the right — rather than the label-above-control
  // stack every other field uses, which would leave the toggle floating
  // under its own label for no reason.
  if (field.control === "switch") {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={id}>{field.label}</Label>
          {help}
          {fieldError}
        </div>
        {control}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {field.label}
          {field.unit && !isNumeric(field) && (
            <span className="text-ink-muted">({field.unit})</span>
          )}
        </Label>
        {isNumeric(field) && (
          <span className="font-mono text-sm text-ink-muted">
            {String(value ?? "")}
            {field.unit}
          </span>
        )}
      </div>
      {control}
      {help}
      {fieldError}
    </div>
  );
}

function isNumeric(field: FieldSpec): boolean {
  return field.control === "slider" || field.control === "number";
}

interface FieldControlProps {
  id: string;
  field: FieldSpec;
  value: unknown;
  disabled: boolean;
  describedBy?: string;
  onChange: (value: unknown) => void;
}

function FieldControl({
  id,
  field,
  value,
  disabled,
  describedBy,
  onChange,
}: FieldControlProps) {
  switch (field.control) {
    case "switch":
      return (
        <Switch
          id={id}
          checked={Boolean(value)}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-describedby={describedBy}
        />
      );
    case "select":
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger id={id} aria-describedby={describedBy}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "slider": {
      const current = typeof value === "number" ? value : field.min;
      return (
        <Slider
          id={id}
          min={field.min}
          max={field.max}
          step={field.step}
          value={[current]}
          onValueChange={([next]) => onChange(next)}
          disabled={disabled}
          aria-describedby={describedBy}
        />
      );
    }
    case "number":
      return (
        <Input
          id={id}
          type="number"
          min={Number.isFinite(field.min) ? field.min : undefined}
          max={Number.isFinite(field.max) ? field.max : undefined}
          step={field.step}
          value={typeof value === "number" ? value : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
          }
          disabled={disabled}
          aria-describedby={describedBy}
        />
      );
    case "text":
      return (
        <Input
          id={id}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={describedBy}
        />
      );
    case "crop":
      // Unreachable in practice — `OptionsForm` filters "crop" fields out
      // above — kept only so this switch stays exhaustive over every
      // `FieldSpec` control, matching every other case here.
      return null;
  }
}
