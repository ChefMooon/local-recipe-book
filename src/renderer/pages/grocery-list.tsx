import { useMemo, useState } from "react";
import { ShoppingCart } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson, isApiError } from "@/lib/api";
import { useToast } from "@/components/providers/toast-provider";
import { isServerConfigReady } from "@/lib/config";
import { useServerConfig } from "@/lib/use-server-config";
import {
  deriveGroceryList,
  isToday,
  isUpcoming,
  removeGroceryListFromCollection,
  sortGroceryLists,
  upsertGroceryList,
  updateGroceryListInCollection,
  type GroceryItem,
  type GroceryList,
  type QuickFilter,
} from "@/lib/grocery";

import styles from "@/components/grocery-list/grocery-list.module.css";
import { ListEditor } from "@/components/grocery-list/ListEditor";
import { ListsSidebar } from "@/components/grocery-list/ListsSidebar";
import { NewListModal } from "@/components/grocery-list/NewListModal";
import { QuickReference } from "@/components/grocery-list/QuickReference";
import { PageHeader } from "@/components/ui/PageHeader";

import { LIST_REFETCH_INTERVAL_MS } from "@/lib/query-intervals";

export default function GroceryListPage() {
  const config = useServerConfig();
  const apiReady = isServerConfigReady(config);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listsQueryKey = ["grocery-lists"] as const;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<QuickFilter>("today");
  const [upcomingDays, setUpcomingDays] = useState(7);
  const [showNewModal, setShowNewModal] = useState(false);
  const { toast } = useToast();

  const listsQuery = useQuery({
    queryKey: ["grocery-lists"],
    enabled: apiReady,
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
    queryFn: () =>
      fetchJson<{ data: GroceryList[] }>("/api/grocery-lists").then(
        (response) => response.data
      ),
  });

  const lists = useMemo(
    () => sortGroceryLists(listsQuery.data ?? []),
    [listsQuery.data]
  );
  const isInitialListLoad = !listsQuery.data && listsQuery.isLoading;

  const selectedList = useMemo(() => {
    if (selectedId) {
      const found = lists.find((list) => list.id === selectedId);
      if (found) {
        return found;
      }
    }

    return lists[0] ?? null;
  }, [lists, selectedId]);

  const filteredQuick = useMemo(() => {
    if (activeFilter === "today") {
      return sortGroceryLists(lists.filter((list) => isToday(list.date)));
    }
    if (activeFilter === "upcoming") {
      return sortGroceryLists(
        lists.filter((list) => isUpcoming(list.date, upcomingDays))
      );
    }
    if (activeFilter === "ongoing") {
      return sortGroceryLists(lists.filter((list) => list.date === null));
    }
    if (activeFilter === "fav") {
      return sortGroceryLists(lists.filter((list) => list.favourite));
    }
    if (activeFilter === "recent") {
      return sortGroceryLists(lists).slice(0, 5);
    }
    return sortGroceryLists(lists);
  }, [activeFilter, lists, upcomingDays]);

  const setListsCache = (
    updater: (current: GroceryList[]) => GroceryList[]
  ) => {
    queryClient.setQueryData<GroceryList[]>(listsQueryKey, (current) =>
      sortGroceryLists(updater(current ?? []))
    );
  };

  const setListCache = (
    listId: string,
    updater: (current: GroceryList) => GroceryList
  ) => {
    queryClient.setQueryData<GroceryList | undefined>(
      ["grocery-list", listId],
      (current) => (current ? deriveGroceryList(updater(current)) : current)
    );
  };

  const syncList = (nextList: GroceryList, previousId?: string) => {
    if (previousId && previousId !== nextList.id) {
      setListsCache((current) =>
        removeGroceryListFromCollection(current, previousId)
      );
      queryClient.removeQueries({
        queryKey: ["grocery-list", previousId],
        exact: true,
      });
    }

    setListsCache((current) => upsertGroceryList(current, nextList));
    queryClient.setQueryData(
      ["grocery-list", nextList.id],
      deriveGroceryList(nextList, nextList.updatedAt)
    );
  };

  const rollbackListSnapshots = (
    previousLists: GroceryList[] | undefined,
    previousList: GroceryList | undefined,
    listId: string,
    clearList = false
  ) => {
    queryClient.setQueryData(listsQueryKey, previousLists);
    if (clearList) {
      queryClient.removeQueries({
        queryKey: ["grocery-list", listId],
        exact: true,
      });
    } else {
      queryClient.setQueryData(["grocery-list", listId], previousList);
    }
  };

  const patchList = async (id: string, payload: Partial<GroceryList>) => {
    const previousLists =
      queryClient.getQueryData<GroceryList[]>(listsQueryKey);
    const previousList = queryClient.getQueryData<GroceryList>([
      "grocery-list",
      id,
    ]);

    setListsCache((current) =>
      updateGroceryListInCollection(current, id, (list) => ({
        ...list,
        ...payload,
      }))
    );
    setListCache(id, (list) => ({ ...list, ...payload }));

    try {
      const response = await fetchJson<{ data: GroceryList }>(
        `/api/grocery-lists/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );
      syncList(response.data);
    } catch (error) {
      rollbackListSnapshots(previousLists, previousList, id);
      throw error;
    }
  };

  const patchItem = async (
    listId: string,
    itemId: string,
    payload: Partial<GroceryItem>
  ) => {
    const previousLists =
      queryClient.getQueryData<GroceryList[]>(listsQueryKey);
    const previousList = queryClient.getQueryData<GroceryList>([
      "grocery-list",
      listId,
    ]);

    const applyItemUpdate = (list: GroceryList) => ({
      ...list,
      items: list.items.map((item) =>
        item.id === itemId ? { ...item, ...payload } : item
      ),
    });

    setListsCache((current) =>
      updateGroceryListInCollection(current, listId, applyItemUpdate)
    );
    setListCache(listId, applyItemUpdate);

    try {
      const response = await fetchJson<{ data: GroceryList }>(
        `/api/grocery-lists/${listId}/items/${itemId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );
      syncList(response.data);
    } catch (error) {
      rollbackListSnapshots(previousLists, previousList, listId);
      throw error;
    }
  };

  return (
    <>
      <PageHeader
        actions={
          <button
            className={styles.btnNewList}
            onClick={() => setShowNewModal(true)}
            type="button"
          >
            + New List
          </button>
        }
        eyebrow="Grocery Lists"
        subtitle={
          isInitialListLoad
            ? "Loading grocery lists..."
            : `${lists.length} list${lists.length === 1 ? "" : "s"} · select one to edit`
        }
        title="Your Lists"
      />

      {isInitialListLoad ? (
        <div className={styles.mainCols}>
          <div className={styles.editorPlaceholder}>
            <ShoppingCart aria-hidden="true" className={styles.editorPlaceholderIcon} size={40} />
            <p className={styles.editorPlaceholderText}>
              Loading grocery lists...
            </p>
          </div>
        </div>
      ) : (
        <>
          <QuickReference
            activeFilter={activeFilter}
            lists={filteredQuick}
            onChangeUpcomingDays={setUpcomingDays}
            onSelectFilter={setActiveFilter}
            onSelectList={setSelectedId}
            onToggleFav={(id, nextValue) =>
              void patchList(id, { favourite: nextValue })
            }
            selectedId={selectedList?.id ?? null}
            upcomingDays={upcomingDays}
          />

          <div className={styles.mainCols}>
            <ListsSidebar
              lists={lists}
              onSelect={setSelectedId}
              onToggleFav={(id, nextValue) =>
                void patchList(id, { favourite: nextValue })
              }
              selectedId={selectedList?.id ?? null}
            />

            {selectedList ? (
              <ListEditor
                list={selectedList}
                onCreateItem={async (listId, payload) => {
                  const previousLists =
                    queryClient.getQueryData<GroceryList[]>(listsQueryKey);
                  const previousList = queryClient.getQueryData<GroceryList>([
                    "grocery-list",
                    listId,
                  ]);
                  const tempItem: GroceryItem = {
                    id: `temp-${Date.now()}`,
                    name: payload.name,
                    category: "Produce",
                    unit: "",
                    qty: "",
                    notes: "",
                    meal: "",
                    checked: false,
                    sortOrder: selectedList?.items.length ?? 0,
                  };
                  const applyCreate = (list: GroceryList) => ({
                    ...list,
                    items: [...list.items, tempItem],
                  });

                  setListsCache((current) =>
                    updateGroceryListInCollection(current, listId, applyCreate)
                  );
                  setListCache(listId, applyCreate);

                  try {
                    const response = await fetchJson<{ data: GroceryList }>(
                      `/api/grocery-lists/${listId}/items`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          ...payload,
                          category: "Produce",
                          unit: "",
                          qty: "",
                          notes: "",
                          meal: "",
                          checked: false,
                        }),
                      }
                    );
                    syncList(response.data);
                  } catch (error) {
                    rollbackListSnapshots(previousLists, previousList, listId);
                    throw error;
                  }
                }}
                onDeleteItem={async (listId, itemId) => {
                  const previousLists =
                    queryClient.getQueryData<GroceryList[]>(listsQueryKey);
                  const previousList = queryClient.getQueryData<GroceryList>([
                    "grocery-list",
                    listId,
                  ]);
                  const applyDelete = (list: GroceryList) => ({
                    ...list,
                    items: list.items.filter((item) => item.id !== itemId),
                  });

                  setListsCache((current) =>
                    updateGroceryListInCollection(current, listId, applyDelete)
                  );
                  setListCache(listId, applyDelete);

                  try {
                    const response = await fetchJson<{ data: GroceryList }>(
                      `/api/grocery-lists/${listId}/items/${itemId}`,
                      {
                        method: "DELETE",
                      }
                    );
                    syncList(response.data);
                  } catch (error) {
                    rollbackListSnapshots(previousLists, previousList, listId);
                    throw error;
                  }
                }}
                onDeleteList={async (id) => {
                  const previousLists =
                    queryClient.getQueryData<GroceryList[]>(listsQueryKey);
                  const previousList = queryClient.getQueryData<GroceryList>([
                    "grocery-list",
                    id,
                  ]);
                  const remaining = removeGroceryListFromCollection(
                    previousLists ?? [],
                    id
                  );

                  setListsCache((current) =>
                    removeGroceryListFromCollection(current, id)
                  );
                  queryClient.removeQueries({
                    queryKey: ["grocery-list", id],
                    exact: true,
                  });
                  if (selectedList?.id === id) {
                    setSelectedId(remaining[0]?.id ?? null);
                  }

                  try {
                    await fetchJson<{ data: { id: string } }>(
                      `/api/grocery-lists/${id}`,
                      {
                        method: "DELETE",
                      }
                    );
                  } catch (error) {
                    rollbackListSnapshots(previousLists, previousList, id);
                    throw error;
                  }
                }}
                onReorder={async (listId, itemIds) => {
                  const previousLists =
                    queryClient.getQueryData<GroceryList[]>(listsQueryKey);
                  const previousList = queryClient.getQueryData<GroceryList>([
                    "grocery-list",
                    listId,
                  ]);
                  const applyReorder = (list: GroceryList) => ({
                    ...list,
                    items: itemIds
                      .map((itemId, index) => {
                        const item = list.items.find(
                          (entry) => entry.id === itemId
                        );
                        return item ? { ...item, sortOrder: index } : null;
                      })
                      .filter((item): item is GroceryItem => item !== null),
                  });

                  setListsCache((current) =>
                    updateGroceryListInCollection(current, listId, applyReorder)
                  );
                  setListCache(listId, applyReorder);

                  try {
                    const response = await fetchJson<{ data: GroceryList }>(
                      `/api/grocery-lists/${listId}/reorder`,
                      {
                        method: "POST",
                        body: JSON.stringify({ itemIds }),
                      }
                    );
                    syncList(response.data);
                  } catch (error) {
                    rollbackListSnapshots(previousLists, previousList, listId);
                    throw error;
                  }
                }}
                onShop={() => {
                  navigate(`/grocery-list/shop/${selectedList.id}`);
                }}
                onUpdateItem={patchItem}
                onUpdateList={async (id, updates) => {
                  await patchList(id, updates);
                }}
              />
            ) : (
              <div className={styles.editorPlaceholder}>
                <ShoppingCart aria-hidden="true" className={styles.editorPlaceholderIcon} size={40} />
                <p className={styles.editorPlaceholderText}>
                  Select a list to start editing.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {showNewModal ? (
        <NewListModal
          onClose={() => setShowNewModal(false)}
          onCreate={async ({ name, date }) => {
            const previousLists =
              queryClient.getQueryData<GroceryList[]>(listsQueryKey);
            const tempId = `temp-list-${Date.now()}`;
            const optimisticList = deriveGroceryList({
              id: tempId,
              name,
              date: date
                ? new Date(`${date}T12:00:00`).toISOString()
                : null,
              favourite: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              checkedCount: 0,
              totalItems: 0,
              completionPercentage: 0,
              items: [],
            });

            setListsCache((current) => [...current, optimisticList]);
            queryClient.setQueryData(["grocery-list", tempId], optimisticList);
            setSelectedId(tempId);
            setShowNewModal(false);

            try {
              const response = await fetchJson<{ data: GroceryList }>(
                "/api/grocery-lists",
                {
                  method: "POST",
                  body: JSON.stringify({
                    name,
                    date: date
                      ? new Date(`${date}T12:00:00`).toISOString()
                      : null,
                  }),
                }
              );
              syncList(response.data, tempId);
              setSelectedId(response.data.id);
            } catch (error) {
              queryClient.setQueryData(listsQueryKey, previousLists);
              queryClient.removeQueries({
                queryKey: ["grocery-list", tempId],
                exact: true,
              });
              setSelectedId(previousLists?.[0]?.id ?? null);

              const description = isApiError<{ error?: string }>(error)
                ? (error.data?.error ?? error.message)
                : "Please try again.";

              toast({
                title: "Could not create grocery list.",
                description,
                variant: "error",
              });
            }
          }}
        />
      ) : null}
    </>
  );
}
