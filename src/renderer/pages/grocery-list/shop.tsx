import { useMemo, useState } from "react";
import { Check, CookingPot, X } from "@phosphor-icons/react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api";
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
  const [isMarkingAllComplete, setIsMarkingAllComplete] = useState(false);

  const listQuery = useQuery({
    queryKey: ["grocery-list", id],
    queryFn: () =>
      fetchJson<{ data: GroceryList }>(`/api/grocery-lists/${id}`).then(
        (response) => response.data
      ),
    enabled: apiReady && Boolean(id),
  });

  const list = listQuery.data;
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
  );
}
