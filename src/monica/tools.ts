import type { MonicaClient } from "./client.ts";

/** A native Monica tool: MCP advertisement + a handler that calls the REST API. */
export interface MonicaTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  handler: (client: MonicaClient, args: Record<string, any>) => Promise<unknown>;
}

type Op = "list" | "get" | "create" | "update" | "delete";

interface ResourceDef {
  /** Plural noun: used for the `list_<plural>` tool name. */
  plural: string;
  /** Singular noun: used for `get_/create_/update_/delete_<singular>` tool names. */
  singular: string;
  /** Human label for descriptions (defaults to singular with underscores → spaces). */
  label?: string;
  /** URL path segment under `/api` (defaults to `/<plural>`). */
  path?: string;
  ops: Op[];
  /** Expose `query` on the list tool (Monica supports `?query=` on some collections). */
  search?: boolean;
  /** Resource also lives under `/contacts/{id}/<path>`; list accepts an optional contact_id. */
  contactScoped?: boolean;
  /**
   * Human-readable summary of the create/update `data` payload (required + optional
   * fields, allowed values, date formats). Surfaced in the create/update tool
   * descriptions and the `data` schema so the agent doesn't have to guess. Monica's
   * REST shapes drift, so keep these in sync with https://www.monicahq.com/api.
   */
  fields?: string;
}

const PAGINATION = {
  page: { type: "integer", minimum: 1, description: "Page number (default 1)." },
  limit: { type: "integer", minimum: 1, maximum: 100, description: "Items per page (max 100, default 10)." },
} as const;

function labelOf(def: ResourceDef): string {
  return def.label ?? def.singular.replace(/_/g, " ");
}

/** Generate the CRUD tools for one Monica resource from its declaration. */
function crudTools(def: ResourceDef): MonicaTool[] {
  const path = def.path ?? `/${def.plural}`;
  const label = labelOf(def);
  const tools: MonicaTool[] = [];

  if (def.ops.includes("list")) {
    const props: Record<string, unknown> = { ...PAGINATION };
    if (def.search) props.query = { type: "string", description: `Search ${def.plural} by text.` };
    if (def.contactScoped) props.contact_id = { type: "integer", description: `Limit to one contact's ${def.plural}.` };
    tools.push({
      name: `list_${def.plural}`,
      description: `List ${def.plural} (paginated).`,
      inputSchema: { type: "object", properties: props },
      readOnly: true,
      handler: (client, args) => {
        const { contact_id, ...query } = args;
        const base = def.contactScoped && contact_id ? `/contacts/${contact_id}${path}` : path;
        return client.request("GET", base, { query });
      },
    });
  }

  if (def.ops.includes("get")) {
    tools.push({
      name: `get_${def.singular}`,
      description: `Get a single ${label} by id.`,
      inputSchema: { type: "object", properties: { id: { type: "integer", description: `The ${label} id.` } }, required: ["id"] },
      readOnly: true,
      handler: (client, args) => client.request("GET", `${path}/${args.id}`),
    });
  }

  if (def.ops.includes("create")) {
    const createDesc = def.fields
      ? `Create a ${label}. Build the \`data\` object from these Monica fields — ${def.fields}`
      : `Create a ${label}. Pass the Monica field set in \`data\` (see ${path} in the Monica API docs for required fields).`;
    tools.push({
      name: `create_${def.singular}`,
      description: createDesc,
      inputSchema: {
        type: "object",
        properties: {
          data: {
            type: "object",
            description: def.fields ? `Fields for the new ${label} — ${def.fields}` : `Fields for the new ${label}.`,
            additionalProperties: true,
          },
        },
        required: ["data"],
      },
      handler: (client, args) => client.request("POST", path, { body: args.data }),
    });
  }

  if (def.ops.includes("update")) {
    const updateDesc = def.fields
      ? `Update a ${label}. Monica PUT replaces the record, so include the full field set in \`data\` (not just changed fields) — ${def.fields}`
      : `Update a ${label}. Monica PUT replaces the record, so include all required fields in \`data\`.`;
    tools.push({
      name: `update_${def.singular}`,
      description: updateDesc,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", description: `The ${label} id.` },
          data: {
            type: "object",
            description: def.fields ? `Full field set for the ${label} — ${def.fields}` : `Full field set for the ${label}.`,
            additionalProperties: true,
          },
        },
        required: ["id", "data"],
      },
      handler: (client, args) => client.request("PUT", `${path}/${args.id}`, { body: args.data }),
    });
  }

  if (def.ops.includes("delete")) {
    tools.push({
      name: `delete_${def.singular}`,
      description: `Delete a ${label} by id.`,
      inputSchema: { type: "object", properties: { id: { type: "integer", description: `The ${label} id.` } }, required: ["id"] },
      handler: (client, args) => client.request("DELETE", `${path}/${args.id}`),
    });
  }

  return tools;
}

const CRUD: Op[] = ["list", "get", "create", "update", "delete"];

const RESOURCES: ResourceDef[] = [
  {
    plural: "contacts",
    singular: "contact",
    ops: CRUD,
    search: true,
    fields:
      'required: first_name (string), gender_id (integer — call list_genders for valid ids), is_birthdate_known (bool), is_deceased (bool), is_deceased_date_known (bool). optional: last_name, nickname, and when is_birthdate_known=true: birthdate_day/birthdate_month/birthdate_year (or birthdate_is_age_based=true + birthdate_age). Minimal example: {"first_name":"Jane","last_name":"Doe","gender_id":1,"is_birthdate_known":false,"is_deceased":false,"is_deceased_date_known":false}.',
  },
  {
    plural: "notes",
    singular: "note",
    ops: CRUD,
    contactScoped: true,
    fields: "required: body (string), contact_id (integer), is_favorited (0 or 1).",
  },
  {
    plural: "activities",
    singular: "activity",
    ops: CRUD,
    contactScoped: true,
    fields:
      "required: activity_type_id (integer — call list_activitytypes), summary (string), happened_at (YYYY-MM-DD), contacts (array of contact ids, at least one). optional: description (string), emotions (array of emotion ids).",
  },
  {
    plural: "calls",
    singular: "call",
    ops: CRUD,
    contactScoped: true,
    fields: "required: content (string), contact_id (integer), called_at (YYYY-MM-DD).",
  },
  {
    plural: "conversations",
    singular: "conversation",
    ops: CRUD,
    contactScoped: true,
    fields:
      "required: happened_at (YYYY-MM-DD), contact_field_type_id (integer — the medium, call list_contactfieldtypes), contact_id (integer). Add messages afterward with add_conversation_message.",
  },
  {
    plural: "reminders",
    singular: "reminder",
    ops: CRUD,
    contactScoped: true,
    fields:
      'required: title (string), next_expected_date (YYYY-MM-DD, in the future), frequency_type (one of "one_time", "week", "month", "year"), contact_id (integer). optional: description (string), frequency_number (integer — how many of the unit between recurrences; for one_time pass 1 or omit).',
  },
  {
    plural: "tasks",
    singular: "task",
    ops: CRUD,
    contactScoped: true,
    fields: "required: title (string), completed (0 or 1), contact_id (integer). optional: description (string), completed_at (YYYY-MM-DD).",
  },
  { plural: "tags", singular: "tag", ops: CRUD, fields: "required: name (string)." },
  {
    plural: "journal",
    singular: "journal_entry",
    label: "journal entry",
    ops: CRUD,
    fields: "required: title (string), post (string, the entry body).",
  },
  {
    plural: "gifts",
    singular: "gift",
    ops: CRUD,
    contactScoped: true,
    fields:
      'required: contact_id (integer), name (string), status (one of "idea", "offered", "received"). optional: recipient_id (integer), comment (string), url (string), amount (number), date (YYYY-MM-DD).',
  },
  {
    plural: "debts",
    singular: "debt",
    ops: CRUD,
    contactScoped: true,
    fields:
      'required: contact_id (integer), in_debt ("yes" if the user owes the contact, "no" if the contact owes the user), status (one of "inprogress", "complete"), amount (integer). optional: reason (string).',
  },
  {
    plural: "relationships",
    singular: "relationship",
    ops: ["get", "create", "update", "delete"],
    fields:
      "required: contact_is (integer — the contact the relationship is linked to), relationship_type_id (integer — call list_relationshiptypes), of_contact (integer — the other contact).",
  },
  {
    plural: "companies",
    singular: "company",
    ops: CRUD,
    fields: "required: name (string). optional: website (string), number_of_employees (integer).",
  },
  { plural: "groups", singular: "group", ops: CRUD, fields: "required: name (string)." },
  {
    plural: "addresses",
    singular: "address",
    ops: CRUD,
    contactScoped: true,
    fields:
      "required: name (string — a short label like \"Home\"), contact_id (integer). optional: street, city, province, postal_code (strings), country (country id from list_countries).",
  },
  {
    plural: "contactfields",
    singular: "contact_field",
    label: "contact field",
    ops: CRUD,
    contactScoped: true,
    fields:
      "required: data (string — the value, e.g. an email address or phone number), contact_field_type_id (integer — call list_contactfieldtypes), contact_id (integer).",
  },
  {
    plural: "occupations",
    singular: "occupation",
    ops: CRUD,
    fields:
      "required: contact_id (integer), company_id (integer — call list_companies or create one), title (string). optional: description, salary (integer), salary_unit (string), currently_works_here (bool), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD).",
  },
  { plural: "documents", singular: "document", ops: ["list", "get", "delete"], contactScoped: true },
  { plural: "photos", singular: "photo", ops: ["list", "get", "delete"], contactScoped: true },
  // read-only reference data
  { plural: "genders", singular: "gender", ops: ["list", "get"] },
  { plural: "contactfieldtypes", singular: "contact_field_type", label: "contact field type", ops: ["list", "get"] },
  { plural: "activitytypes", singular: "activity_type", label: "activity type", ops: ["list", "get"] },
  { plural: "activitytypecategories", singular: "activity_type_category", label: "activity type category", ops: ["list", "get"] },
  { plural: "relationshiptypes", singular: "relationship_type", label: "relationship type", ops: ["list", "get"] },
  { plural: "currencies", singular: "currency", ops: ["list"] },
  { plural: "countries", singular: "country", ops: ["list"] },
];

/** Hand-written tools that don't fit the uniform CRUD shape. */
const SPECIAL_TOOLS: MonicaTool[] = [
  {
    name: "me",
    description: "Get the authenticated Monica user (also the quickest connectivity check).",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    handler: (client) => client.request("GET", "/me"),
  },
  {
    name: "search_contacts",
    description: "Search contacts by name or other text. Returns a paginated list.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for." },
        page: PAGINATION.page,
        limit: PAGINATION.limit,
      },
      required: ["query"],
    },
    readOnly: true,
    handler: (client, args) =>
      client.request("GET", "/contacts", { query: { query: args.query, page: args.page, limit: args.limit } }),
  },
  {
    name: "set_contact_tags",
    description: "Add one or more tags (by name) to a contact. Tags are created if they don't exist.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "integer", description: "The contact id." },
        tags: { type: "array", items: { type: "string" }, description: "Tag names to add." },
      },
      required: ["contact_id", "tags"],
    },
    handler: (client, args) => client.request("POST", `/contacts/${args.contact_id}/setTags`, { body: { tags: args.tags } }),
  },
  {
    name: "unset_contact_tags",
    description: "Remove one or more tags (by tag id) from a contact.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "integer", description: "The contact id." },
        tags: { type: "array", items: { type: "integer" }, description: "Tag ids to remove." },
      },
      required: ["contact_id", "tags"],
    },
    handler: (client, args) => client.request("POST", `/contacts/${args.contact_id}/unsetTag`, { body: { tags: args.tags } }),
  },
  {
    name: "add_conversation_message",
    description: "Add a message to an existing conversation.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "integer", description: "The conversation id." },
        data: {
          type: "object",
          description:
            "Message fields, all required — content (string, the message text), written_at (YYYY-MM-DD), written_by_me (bool: true if the user wrote it, false if the contact did), contact_id (integer).",
          additionalProperties: true,
        },
      },
      required: ["conversation_id", "data"],
    },
    handler: (client, args) => client.request("POST", `/conversations/${args.conversation_id}/messages`, { body: args.data }),
  },
];

/** The full static tool registry — identical for every user; only credentials differ. */
export const MONICA_TOOLS: MonicaTool[] = [...SPECIAL_TOOLS, ...RESOURCES.flatMap(crudTools)].sort((a, b) =>
  a.name.localeCompare(b.name),
);

export const MONICA_TOOLS_BY_NAME: Map<string, MonicaTool> = new Map(MONICA_TOOLS.map((t) => [t.name, t]));
