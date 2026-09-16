import { useMemo, useState } from "react";
import { Check, CookingPot, X } from "@phosphor-icons/react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api";
import { ModalShell } from "@/components/ui/ModalShell";
import { useToast } from "@/components/providers/toast-provider";
import { isServerConfigReady } from "@/lib/config";
import { useServerConfig } from "@/lib/use-server-config";
import {
  deriveGroceryList,
  groupByCategory,
  listProgress,
  updateGroceryListInCollection,
  type GroceryItem,
  type GroceryList,
} from "@/lib/grocery";

import styles from "./shop.module.css";

type PantryReviewProposal = {
  groceryItemId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  match: {
    status: "matched" | "ambiguous" | "suggestion" | "unmatched";
    item: { id: string; name: string; stockMode: "always-available" | "track-quantity" | "replenish-to-target" } | null;
    suggestions: Array<{ id: string; name: string; score: number }>;
    explanation: string | null;
  };
  explanation: string | null;
};

function PantryReviewModal({
  proposals,
  onClose,
  onApply,
}: {
  proposals: PantryReviewProposal[];
  onClose: () => void;
  onApply: (decisions: Array<Record<string, unknown>>, skippedNames: string[]) => Promise<void>;
}) {
  const [actions, setActions] = useState<Record<string, "match" | "create" | "skip">>(() =>
    Object.fromEntries(proposals.map((proposal) => [
      proposal.groceryItemId,
      proposal.match.status === "matched" && proposal.match.item?.stockMode !== "always-available" ? "match" : "skip",
    ]))
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(proposals.map((proposal) => [proposal.groceryItemId, proposal.quantity?.toString() ?? ""]))
  );
  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries(proposals.map((proposal) => [proposal.groceryItemId, proposal.unit ?? ""]))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <ModalShell
      ariaLabel="Review Pantry updates"
      closeDisabled={saving}
      footerLeft={<button className={styles.backBtn} disabled={saving} onClick={onClose} type="button">Skip review</button>}
      footerRight={<button className={styles.completeBtn} disabled={saving} onClick={async () => {
        setSaving(true);
        setError(null);
        try {
          const skippedNames = proposals
            .filter((proposal) => proposal.match.item?.stockMode === "always-available")
            .map((proposal) => proposal.name);
          await onApply(proposals.map((proposal) => {
            const isAlwaysAvailable = proposal.match.item?.stockMode === "always-available";
            return {
              itemId: proposal.groceryItemId,
              action: isAlwaysAvailable ? "skip" : actions[proposal.groceryItemId],
              pantryItemId: isAlwaysAvailable ? undefined : proposal.match.item?.id ?? proposal.match.suggestions[0]?.id,
              purchasedQuantity: isAlwaysAvailable ? null : quantities[proposal.groceryItemId] ? Number(quantities[proposal.groceryItemId]) : null,
              unit: isAlwaysAvailable ? null : units[proposal.groceryItemId].trim() || null,
            };
          }), skippedNames);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unable to update Pantry.");
        } finally {
          setSaving(false);
        }
      }} type="button">{saving ? "Updating Pantry..." : "Update Pantry"}</button>}
      onClose={onClose}
      open
      subtitle="Confirm what you brought home. Suggestions never update Pantry until you choose an action."
      title="Review Pantry updates"
    >
      {error ? <div className={styles.reviewError} role="alert">{error}</div> : null}
      <div className={styles.reviewList}>
        {proposals.map((proposal) => (
          <div className={styles.reviewRow} key={proposal.groceryItemId}>
            <div><strong>{proposal.name}</strong><span>{proposal.explanation ?? proposal.match.explanation ?? "Purchased item"}</span></div>
            <label>Purchased quantity<input disabled={proposal.match.item?.stockMode === "always-available"} inputMode="decimal" min="0" type="number" value={quantities[proposal.groceryItemId]} onChange={(event) => setQuantities((current) => ({ ...current, [proposal.groceryItemId]: event.target.value }))} /></label>
            <label>Unit (optional)<input disabled={proposal.match.item?.stockMode === "always-available"} placeholder="e.g. kg, bottle" value={units[proposal.groceryItemId]} onChange={(event) => setUnits((current) => ({ ...current, [proposal.groceryItemId]: event.target.value }))} /></label>
            <label>Action<select disabled={proposal.match.item?.stockMode === "always-available"} value={actions[proposal.groceryItemId]} onChange={(event) => setActions((current) => ({ ...current, [proposal.groceryItemId]: event.target.value as "match" | "create" | "skip" }))}><option value="match" disabled={!proposal.match.item && !proposal.match.suggestions.length}>Match existing</option><option value="create">Create Pantry item</option><option value="skip">Skip</option></select></label>
            {proposal.match.item?.stockMode === "always-available" ? <span className={styles.reviewWarning} role="status">Always available. This item will be skipped and will not change Pantry stock.</span> : null}
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function GroceryShopContent({
  groups,
  list,
  done,
  pct,
  navigate,
  isMarkingAllComplete,
  markAllComplete,
  toggleItem,
}: {
  groups: ReturnType<typeof groupByCategory>;
  list: GroceryList;
  done: number;
  pct: number;
  navigate: ReturnType<typeof useNavigate>;
  isMarkingAllComplete: boolean;
  markAllComplete: () => Promise<void>;
  toggleItem: (item: GroceryItem) => Promise<void>;
}) {
  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <CookingPot aria-hidden="true" className={styles.logo} size={28} />
          <div>
            <div className={styles.listName}>{list.name}</div>
            <div className={styles.progressText}>
              {done} of {list.items.length} collected
            </div>
          </div>
        </div>
        <button
          className={styles.closeBtn}
          onClick={() => navigate("/grocery-list")}
          type="button"
        >
          <X aria-hidden="true" size={18} /> Done
        </button>
      </div>
      <div className={styles.progressBarBg}>
        <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.body}>
        <div className={styles.backRow}>
          <button
            className={styles.backBtn}
            onClick={() => navigate("/grocery-list")}
            type="button"
          >
            Back to Grocery Lists
          </button>
          <button
            className={styles.completeBtn}
            disabled={isMarkingAllComplete}
            onClick={() => void markAllComplete()}
            type="button"
          >
            {isMarkingAllComplete ? "Completing..." : "Mark All Complete"}
          </button>
        </div>
        {groups.map(([category, items]) => (
          <div className={styles.category} key={category}>
            <div className={styles.categoryHeader}>{category}</div>
            {items.map((item) => (
              <button
                className={`${styles.item} ${item.checked ? styles.itemDone : ""}`}
                key={item.id}
                onClick={() => void toggleItem(item)}
                type="button"
              >
                <div
                  className={`${styles.checkCircle} ${item.checked ? styles.checkFilled : ""}`}
                >
                  {item.checked ? (
                    <Check aria-hidden="true" className={styles.checkmark} size={16} weight="bold" />
                  ) : null}
                </div>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{item.name}</span>
                  <div className={styles.itemMeta}>
                    {item.qty ? (
                      <span>
                        {item.qty}
                        {item.unit ? ` ${item.unit}` : ""}
                      </span>
                    ) : null}
                    {item.notes ? (
                      <span className={styles.itemNotes}>· {item.notes}</span>
                    ) : null}
                    {item.meal ? (
                      <span className={styles.itemMeal}>for {item.meal}</span>
                    ) : null}
                  </div>
                </div>
                <div>
                  {item.checked ? (
                    <span className={styles.statusDone}>Collected</span>
                  ) : (
                    <span className={styles.statusOpen}>Needed</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ))}
        {list.items.length === 0 ? (
          <div className={styles.empty}>This list has no items yet.</div>
        ) : null}
      </div>
    </div>
  );
}

export default function GroceryShopPage() {
  const config = useServerConfig();
  const apiReady = isServerConfigReady(config);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isMarkingAllComplete, setIsMarkingAllComplete] = useState(false);
  const [reviewProposals, setReviewProposals] = useState<PantryReviewProposal[] | null>(null);
  const [autoReviewPantry, setAutoReviewPantry] = useState(true);

  const listQuery = useQuery({
    queryKey: ["grocery-list", id],
    queryFn: () =>
      fetchJson<{ data: GroceryList }>(`/api/grocery-lists/${id}`).then(
        (response) => response.data
      ),
    enabled: apiReady && Boolean(id),
  });

  const list = listQuery.data;
  useQuery({
    queryKey: ["preferences"],
    enabled: apiReady,
    queryFn: () => fetchJson<{ data: { autoReviewPantry?: boolean } }>("/api/preferences").then((response) => {
      setAutoReviewPantry(response.data.autoReviewPantry !== false);
      return response.data;
    }),
  });
  const groups = useMemo(
    () => groupByCategory(list?.items ?? []),
    [list?.items]
  );
  const done = list?.items.filter((item) => item.checked).length ?? 0;
  const pct = list ? listProgress(list.items) : 0;

  const toggleItem = async (item: GroceryItem) => {
    if (!list || !id) {
      return;
    }

    const previousList = queryClient.getQueryData<GroceryList>([
      "grocery-list",
      id,
    ]);
    const previousLists = queryClient.getQueryData<GroceryList[]>([
      "grocery-lists",
    ]);
    const applyToggle = (current: GroceryList) => ({
      ...current,
      items: current.items.map((entry) =>
        entry.id === item.id ? { ...entry, checked: !entry.checked } : entry
      ),
    });

    queryClient.setQueryData<GroceryList | undefined>(
      ["grocery-list", id],
      (current) => (current ? deriveGroceryList(applyToggle(current)) : current)
    );
    queryClient.setQueryData<GroceryList[] | undefined>(
      ["grocery-lists"],
      (current) =>
        current
          ? updateGroceryListInCollection(current, list.id, applyToggle)
          : current
    );

    try {
      const response = await fetchJson<{ data: GroceryList }>(
        `/api/grocery-lists/${list.id}/items/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ checked: !item.checked }),
        }
      );

      queryClient.setQueryData(["grocery-list", id], response.data);
      queryClient.setQueryData<GroceryList[] | undefined>(
        ["grocery-lists"],
        (current) =>
          current
            ? current.map((entry) =>
                entry.id === response.data.id ? response.data : entry
              )
            : current
      );
    } catch (error) {
      queryClient.setQueryData(["grocery-list", id], previousList);
      queryClient.setQueryData(["grocery-lists"], previousLists);
      throw error;
    }
  };

  const markAllComplete = async () => {
    if (!list || !id || isMarkingAllComplete) {
      return;
    }

    const previousList = queryClient.getQueryData<GroceryList>([
      "grocery-list",
      id,
    ]);
    const previousLists = queryClient.getQueryData<GroceryList[]>([
      "grocery-lists",
    ]);
    const applyCompleteAll = (current: GroceryList) => ({
      ...current,
      items: current.items.map((entry) => ({
        ...entry,
        checked: true,
      })),
    });
    const uncheckedItems = list.items.filter((item) => !item.checked);

    queryClient.setQueryData<GroceryList | undefined>(
      ["grocery-list", id],
      (current) =>
        current ? deriveGroceryList(applyCompleteAll(current)) : current
    );
    queryClient.setQueryData<GroceryList[] | undefined>(
      ["grocery-lists"],
      (current) =>
        current
          ? updateGroceryListInCollection(current, list.id, applyCompleteAll)
          : current
    );

    if (uncheckedItems.length === 0) {
      if (autoReviewPantry) {
        const review = await fetchJson<{ data: PantryReviewProposal[] }>(`/api/grocery-lists/${id}/pantry-review`);
        if (review.data.length) {
          setReviewProposals(review.data);
          return;
        }
      }
      navigate("/grocery-list");
      return;
    }

    setIsMarkingAllComplete(true);

    try {
      await Promise.all(
        uncheckedItems.map((item) =>
          fetchJson<{ data: GroceryList }>(
            `/api/grocery-lists/${list.id}/items/${item.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({ checked: true }),
            }
          )
        )
      );

      queryClient.setQueryData<GroceryList | undefined>(
        ["grocery-list", id],
        (current) =>
          current ? deriveGroceryList(applyCompleteAll(current)) : current
      );
      queryClient.setQueryData<GroceryList[] | undefined>(
        ["grocery-lists"],
        (current) =>
          current
            ? updateGroceryListInCollection(current, list.id, applyCompleteAll)
            : current
      );
      if (autoReviewPantry) {
        const review = await fetchJson<{ data: PantryReviewProposal[] }>(`/api/grocery-lists/${id}/pantry-review`);
        if (review.data.length) {
          setReviewProposals(review.data);
          return;
        }
      }
      navigate("/grocery-list");
    } catch (error) {
      queryClient.setQueryData(["grocery-list", id], previousList);
      queryClient.setQueryData(["grocery-lists"], previousLists);
      throw error;
    } finally {
      setIsMarkingAllComplete(false);
    }
  };

  if (!list) {
    return <div>Loading shopping view...</div>;
  }

  return (
    <>
      <GroceryShopContent
        done={done}
        groups={groups}
        isMarkingAllComplete={isMarkingAllComplete}
        list={list}
        navigate={navigate}
        markAllComplete={markAllComplete}
        pct={pct}
        toggleItem={toggleItem}
      />
      {reviewProposals ? (
        <PantryReviewModal
          onApply={async (decisions, skippedNames) => {
            await fetchJson(`/api/grocery-lists/${id}/pantry-review`, {
              method: "POST",
              body: JSON.stringify({ decisions }),
            });
            if (skippedNames.length) {
              toast({
                title: "Pantry update completed",
                description: `${skippedNames.join(", ")} ${skippedNames.length === 1 ? "was" : "were"} skipped because ${skippedNames.length === 1 ? "it is" : "they are"} always available.`,
              });
            }
            setReviewProposals(null);
            await queryClient.invalidateQueries({ queryKey: ["pantry"] });
            navigate("/grocery-list");
          }}
          onClose={() => {
            setReviewProposals(null);
            navigate("/grocery-list");
          }}
          proposals={reviewProposals}
        />
      ) : null}
    </>
  );
}
