import { z } from "zod";

export const PantryCompletionDecisionSchema = z.object({
  itemId: z.string().trim().min(1),
  reviewIdentity: z.string().trim().min(1).max(200).optional(),
  action: z.enum(["match", "create", "skip"]),
  pantryItemId: z.string().trim().min(1).optional(),
  purchasedQuantity: z.number().finite().nonnegative().nullable().optional(),
  unit: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().min(1).nullable().optional()
  ),
  location: z.string().trim().min(1).optional(),
  approximate: z.boolean().optional(),
});

export const PantryCompletionApplySchema = z.object({
  decisions: z.array(PantryCompletionDecisionSchema),
});

export type PantryCompletionDecision = z.infer<typeof PantryCompletionDecisionSchema>;