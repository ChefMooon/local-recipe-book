import { z } from "zod";

export const PANTRY_ATTENTION_SOURCES = [
  "snooze",
  "until-restocked",
  "grocery-link",
] as const;

export const PANTRY_GROCERY_LINK_STATUSES = [
  "active",
  "checked",
  "removed",
  "completed",
  "skipped",
  "failed-review",
  "unlinked",
] as const;

const identitySchema = z.string().trim().min(1).max(200);
const nullableDateSchema = z.string().datetime().nullable().optional();

export const PantryAttentionMutationSchema = z
  .object({
    source: z.enum(PANTRY_ATTENTION_SOURCES),
    expiresAt: nullableDateSchema,
    groceryLinkId: identitySchema.nullable().optional(),
    operationIdentity: identitySchema,
    reviewIdentity: identitySchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.source === "snooze" && !value.expiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Snoozed attention requires an expiry",
      });
    }
    if (value.source === "until-restocked" && value.expiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Until-restocked attention cannot have an expiry",
      });
    }
    if (value.source === "grocery-link" && !value.groceryLinkId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groceryLinkId"],
        message: "Linked attention requires a grocery link",
      });
    }
  });

export const PantryAttentionClearSchema = z.object({
  attentionId: identitySchema,
  operationIdentity: identitySchema,
  reviewIdentity: identitySchema.nullable().optional(),
});

export const PantryGroceryLinkCreateSchema = z.object({
  groceryItemId: identitySchema,
  operationIdentity: identitySchema,
  reviewIdentity: identitySchema.nullable().optional(),
});

export const PantryGroceryItemActionSchema = z.object({
  operationIdentity: identitySchema,
  reviewIdentity: identitySchema.nullable().optional(),
});

export const PantryGroceryLinkLifecycleSchema = z.object({
  linkId: identitySchema,
  status: z.enum(PANTRY_GROCERY_LINK_STATUSES),
  operationIdentity: identitySchema,
  reviewIdentity: identitySchema.nullable().optional(),
});

export const PantryAttentionPayloadSchema = z
  .object({
    id: identitySchema,
    pantryItemId: identitySchema,
    source: z.enum(PANTRY_ATTENTION_SOURCES),
    expiresAt: z.string().datetime().nullable(),
    groceryLinkId: identitySchema.nullable(),
    operationIdentity: identitySchema,
    reviewIdentity: identitySchema.nullable(),
    active: z.boolean(),
    closedAt: z.string().datetime().nullable(),
    closeReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const PantryAttentionViewSchema = z
  .object({
    id: identitySchema.nullable(),
    source: z.enum(PANTRY_ATTENTION_SOURCES).nullable(),
    expiresAt: z.string().datetime().nullable(),
    suppressed: z.boolean(),
    visible: z.boolean(),
    stock: z.boolean(),
    forecast: z.boolean(),
    safety: z.boolean(),
  })
  .strict();

export const PantryGroceryLinkPayloadSchema = z
  .object({
    id: identitySchema,
    pantryItemId: identitySchema,
    groceryItemId: identitySchema,
    groceryItemName: z.string().nullable().optional(),
    groceryListId: identitySchema.nullable().optional(),
    groceryListName: z.string().nullable().optional(),
    status: z.enum(PANTRY_GROCERY_LINK_STATUSES),
    active: z.boolean(),
    operationIdentity: identitySchema,
    reviewIdentity: identitySchema.nullable(),
    closedAt: z.string().datetime().nullable(),
    closeReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PantryAttentionSource = (typeof PANTRY_ATTENTION_SOURCES)[number];
export type PantryGroceryLinkStatus = (typeof PANTRY_GROCERY_LINK_STATUSES)[number];
export type PantryAttentionMutation = z.infer<typeof PantryAttentionMutationSchema>;
export type PantryAttentionClear = z.infer<typeof PantryAttentionClearSchema>;
export type PantryGroceryLinkCreate = z.infer<typeof PantryGroceryLinkCreateSchema>;
export type PantryGroceryItemAction = z.infer<typeof PantryGroceryItemActionSchema>;
export type PantryGroceryLinkLifecycle = z.infer<typeof PantryGroceryLinkLifecycleSchema>;
export type PantryAttentionPayload = z.infer<typeof PantryAttentionPayloadSchema>;
export type PantryAttentionView = z.infer<typeof PantryAttentionViewSchema>;
export type PantryGroceryLinkPayload = z.infer<typeof PantryGroceryLinkPayloadSchema>;