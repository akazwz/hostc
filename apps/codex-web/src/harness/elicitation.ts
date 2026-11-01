// MCP form questions: a small JSON schema, turned into fields and back into the answer it asks for.

export type FormOption = { value: string; label: string };

export type FormField = {
	name: string;
	label: string;
	description: string;
	required: boolean;
	kind: "text" | "number" | "boolean" | "select" | "multi";
	inputType: string;
	options: FormOption[];
	defaultValue: string | number | boolean | string[] | undefined;
};

type RawOption = { const: string; title: string };
type RawField = {
	type?: string;
	title?: string;
	description?: string;
	format?: string;
	enum?: string[];
	enumNames?: string[];
	oneOf?: RawOption[];
	items?: { enum?: string[]; anyOf?: RawOption[] };
	default?: string | number | boolean | string[];
};
export type RawSchema = { properties?: Record<string, RawField>; required?: string[] };

const INPUT_TYPES: Record<string, string> = { email: "email", uri: "url", date: "date", "date-time": "datetime-local" };

function optionsOf(field: RawField): FormOption[] {
	if (field.oneOf) {
		return field.oneOf.map((option) => ({ value: option.const, label: option.title }));
	}
	if (field.items?.anyOf) {
		return field.items.anyOf.map((option) => ({ value: option.const, label: option.title }));
	}
	const values = field.enum ?? field.items?.enum ?? [];
	return values.map((value, index) => ({ value, label: field.enumNames?.[index] ?? value }));
}

function kindOf(field: RawField): FormField["kind"] {
	if (field.type === "array") {
		return "multi";
	}
	if (field.type === "boolean") {
		return "boolean";
	}
	if (field.type === "number" || field.type === "integer") {
		return "number";
	}
	return field.oneOf || field.enum ? "select" : "text";
}

export function formFields(schema: RawSchema | null | undefined): FormField[] {
	return Object.entries(schema?.properties ?? {}).map(([name, field]) => ({
		name,
		label: field.title ?? name,
		description: field.description ?? "",
		required: schema?.required?.includes(name) ?? false,
		kind: kindOf(field),
		inputType: INPUT_TYPES[field.format ?? ""] ?? "text",
		options: optionsOf(field),
		defaultValue: field.default,
	}));
}

/** The answer, with each value in the type its schema asks for. */
export function formContent(
	fields: readonly FormField[],
	data: { get(name: string): unknown; getAll(name: string): unknown[] },
): Record<string, unknown> {
	const content: Record<string, unknown> = {};
	for (const field of fields) {
		if (field.kind === "boolean") {
			content[field.name] = data.get(field.name) !== null;
		} else if (field.kind === "multi") {
			content[field.name] = data.getAll(field.name).map(String);
		} else {
			const value = data.get(field.name);
			if (value !== null && value !== "") {
				content[field.name] = field.kind === "number" ? Number(value) : String(value);
			}
		}
	}
	return content;
}
