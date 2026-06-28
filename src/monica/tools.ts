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
    tools.push({
      name: `create_${def.singular}`,
      description: `Create a ${label}. Pass the Monica field set in \`data\` (see ${path} in the Monica API docs for required fields).`,
      inputSchema: {
        type: "object",
        properties: { data: { type: "object", description: `Fields for the new ${label}.`, additionalProperties: true } },
        required: ["data"],
      },
      handler: (client, args) => client.request("POST", path, { body: args.data }),
    });
  }

  if (def.ops.includes("update")) {
    tools.push({
      name: `update_${def.singular}`,
      description: `Update a ${label}. Monica PUT replaces the record, so include all required fields in \`data\`.`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", description: `The ${label} id.` },
          data: { type: "object", description: `Full field set for the ${label}.`, additionalProperties: true },
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
  { plural: "contacts", singular: "contact", ops: CRUD, search: true },
  { plural: "notes", singular: "note", ops: CRUD, contactScoped: true },
  { plural: "activities", singular: "activity", ops: CRUD, contactScoped: true },
  { plural: "calls", singular: "call", ops: CRUD, contactScoped: true },
  { plural: "conversations", singular: "conversation", ops: CRUD, contactScoped: true },
  { plural: "reminders", singular: "reminder", ops: CRUD, contactScoped: true },
  { plural: "tasks", singular: "task", ops: CRUD, contactScoped: true },
  { plural: "tags", singular: "tag", ops: CRUD },
  { plural: "journal", singular: "journal_entry", label: "journal entry", ops: CRUD },
  { plural: "gifts", singular: "gift", ops: CRUD, contactScoped: true },
  { plural: "debts", singular: "debt", ops: CRUD, contactScoped: true },
  { plural: "relationships", singular: "relationship", ops: ["get", "create", "update", "delete"] },
  { plural: "companies", singular: "company", ops: CRUD },
  { plural: "groups", singular: "group", ops: CRUD },
  { plural: "addresses", singular: "address", ops: CRUD, contactScoped: true },
  { plural: "contactfields", singular: "contact_field", label: "contact field", ops: CRUD, contactScoped: true },
  { plural: "occupations", singular: "occupation", ops: CRUD },
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
        data: { type: "object", description: "Message fields (contact_id, written_at, written_by_me, content).", additionalProperties: true },
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
